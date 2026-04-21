import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  appendMessage,
  findOrCreateSession,
  getSession,
  type ChatSession,
} from './conversations.service.js';
import {
  completeInvocation,
  failInvocation,
  startInvocation,
  type AgentInvocation,
} from './invocations.service.js';

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = 'openclaw';
const DEFAULT_AGENT_ID = 'intella';
const DEFAULT_MODEL = process.env.AGENT_DEFAULT_MODEL ?? 'claude-opus-4-6';
const GATEWAY_TOKEN =
  process.env.OPENCLAW_GATEWAY_TOKEN ?? '8509ebc28b57fb82ea5a8810df5c99a31cc33ca8b2500e21';
const AGENT_TIMEOUT = 120; // seconds

export interface ChatRequest {
  message: string;
  agentId?: string;
  context?: {
    type: string;
    id?: string;
    name?: string;
    emoji?: string;
    section?: string;
    date?: string;
  };
  sessionId?: string;
}

export interface ChatResponse {
  reply: string;
  sessionId: string;
  agentId: string;
  invocationId: string;
}

function buildPrompt(req: ChatRequest): string {
  const parts: string[] = [];

  if (req.context) {
    const ctx = req.context;
    let contextLine = `[Context: viewing ${ctx.type}`;
    if (ctx.name) contextLine += ` "${ctx.name}"`;
    if (ctx.emoji) contextLine += ` ${ctx.emoji}`;
    if (ctx.id) contextLine += ` (id: ${ctx.id})`;
    if (ctx.section) contextLine += ` section: ${ctx.section}`;
    if (ctx.date) contextLine += ` date: ${ctx.date}`;
    contextLine += ']';
    parts.push(contextLine);
  }

  parts.push(req.message);
  return parts.join('\n');
}

async function resolveSession(req: ChatRequest, agentId: string): Promise<ChatSession> {
  if (req.sessionId) {
    // Explicit session id takes precedence. If it doesn't exist, fall back to
    // finding/creating by context so legacy iOS clients (which mint their own
    // session ids) don't break.
    try {
      return await getSession(req.sessionId);
    } catch {
      // fall through to findOrCreateSession
    }
  }

  return findOrCreateSession({
    agentId,
    contextType: req.context?.type ?? null,
    contextId: req.context?.id ?? null,
  });
}

async function runOpenclawAgent(
  agentId: string,
  sessionKey: string,
  prompt: string,
): Promise<string> {
  const args = [
    'agent',
    '--agent', agentId,
    '--session-id', sessionKey,
    '--message', prompt,
    '--json',
    '--timeout', String(AGENT_TIMEOUT),
  ];

  const { stdout } = await execFileAsync(OPENCLAW_BIN, args, {
    timeout: (AGENT_TIMEOUT + 10) * 1000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      OPENCLAW_GATEWAY_TOKEN: GATEWAY_TOKEN,
    },
  });

  const result = JSON.parse(stdout);
  if (result.status !== 'ok') {
    throw new Error(result.summary ?? 'Agent returned non-ok status');
  }

  return result.result?.payloads?.[0]?.text ?? 'No response from agent.';
}

async function sendMessage(req: ChatRequest): Promise<ChatResponse> {
  const agentId = req.agentId?.trim() || DEFAULT_AGENT_ID;
  const prompt = buildPrompt(req);

  const session = await resolveSession(req, agentId);
  await appendMessage({
    sessionId: session.id,
    role: 'user',
    content: prompt,
  });

  const invocation: AgentInvocation = await startInvocation({
    trigger: 'user_chat',
    agentId,
    sessionId: session.id,
    model: DEFAULT_MODEL,
  });

  // openclaw needs a stable per-agent key for its own continuity layer. Keep
  // the legacy shape so existing openclaw sessions on disk aren't orphaned.
  const openclawSessionKey = `intella-ios-${agentId}-${req.context?.type ?? 'app'}-${req.context?.id ?? 'default'}`;

  try {
    const text = await runOpenclawAgent(agentId, openclawSessionKey, prompt);

    await appendMessage({
      sessionId: session.id,
      invocationId: invocation.id,
      role: 'assistant',
      content: text,
    });

    // Token counts aren't available from the openclaw agent CLI; record zero
    // for now. Phase 2 (in-process loop) will populate these.
    await completeInvocation(invocation.id, { tokensIn: 0, tokensOut: 0 });

    return {
      reply: text,
      sessionId: session.id,
      agentId,
      invocationId: invocation.id,
    };
  } catch (err: any) {
    const message = err?.message ?? 'Agent error';
    await failInvocation(invocation.id, { error: message });
    console.error('OpenClaw agent error:', message);
    throw new Error(`Agent error: ${message}`);
  }
}

export const chatService = { sendMessage };
