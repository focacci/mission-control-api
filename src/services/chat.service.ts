import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = 'openclaw';
const DEFAULT_AGENT_ID = 'intella';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? '8509ebc28b57fb82ea5a8810df5c99a31cc33ca8b2500e21';
const AGENT_TIMEOUT = 120; // seconds

interface ChatRequest {
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

interface ChatResponse {
  reply: string;
  sessionId: string;
  agentId: string;
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

async function sendMessage(req: ChatRequest): Promise<ChatResponse> {
  const agentId = req.agentId?.trim() || DEFAULT_AGENT_ID;
  const prompt = buildPrompt(req);
  // Session id is scoped per-agent so conversations with different agents
  // don't bleed into one another, even when visiting the same context.
  const sessionId =
    req.sessionId ??
    `intella-ios-${agentId}-${req.context?.type ?? 'app'}-${req.context?.id ?? 'default'}`;

  const args = [
    'agent',
    '--agent', agentId,
    '--session-id', sessionId,
    '--message', prompt,
    '--json',
    '--timeout', String(AGENT_TIMEOUT),
  ];

  try {
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

    const text = result.result?.payloads?.[0]?.text ?? 'No response from agent.';

    return {
      reply: text,
      sessionId,
      agentId,
    };
  } catch (err: any) {
    console.error('OpenClaw agent error:', err.message);
    throw new Error(`Agent error: ${err.message}`);
  }
}

export const chatService = { sendMessage };
