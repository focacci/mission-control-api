import {
  appendMessage,
  findOrCreateSession,
  getSession,
  type ChatSession,
} from '../services/conversations.service.js';
import {
  getInvocation,
  startInvocation,
  type AgentInvocation,
} from '../services/invocations.service.js';
import { AppError } from '../types/index.types.js';
import type { AgentEvent, AgentEventErrorCode } from './events.js';
import { run, type RunnerOptions } from './runner.js';

const DEFAULT_AGENT_ID = 'intella';
const DEFAULT_MODEL = process.env.AGENT_DEFAULT_MODEL ?? 'claude-sonnet-4.6';

export interface ChatContextInput {
  type: string;
  id?: string;
  name?: string;
  emoji?: string;
  section?: string;
  date?: string;
}

export interface HandleChatTurnParams {
  message: string;
  agentId?: string;
  context?: ChatContextInput;
  sessionId?: string;
  onEvent: (e: AgentEvent) => void;
}

export interface HandleChatTurnResult {
  sessionId: string;
  agentId: string;
  invocationId: string;
}

/**
 * Resolve the session for a chat turn. Explicit `sessionId` wins; otherwise
 * fall back to find-or-create by (agentId, contextType, contextId) so legacy
 * iOS clients that don't track session ids get a stable one per context.
 */
async function resolveSession(
  params: HandleChatTurnParams,
  agentId: string,
): Promise<ChatSession> {
  if (params.sessionId) {
    try {
      return await getSession(params.sessionId);
    } catch {
      // Fall through — create a fresh one keyed on context.
    }
  }
  return findOrCreateSession({
    agentId,
    contextType: params.context?.type ?? null,
    contextId: params.context?.id ?? null,
  });
}

function buildUserMessage(params: HandleChatTurnParams): string {
  if (!params.context) return params.message;
  const ctx = params.context;
  const bits: string[] = [`[Context: viewing ${ctx.type}`];
  if (ctx.name) bits.push(` "${ctx.name}"`);
  if (ctx.emoji) bits.push(` ${ctx.emoji}`);
  if (ctx.id) bits.push(` (id: ${ctx.id})`);
  if (ctx.section) bits.push(` section: ${ctx.section}`);
  if (ctx.date) bits.push(` date: ${ctx.date}`);
  bits.push(']');
  const contextLine = bits.join('');
  return `${contextLine}\n${params.message}`;
}

/**
 * Glue between the route handler and the runner. Resolves session, persists
 * the user message, starts an invocation, then delegates to the runner.
 *
 * Gateway-unreachable and daily-cap failures surface as `error` AgentEvents
 * via `onEvent`; this function only throws on unexpected errors (e.g. DB
 * failures). Callers should always `await` and handle both paths.
 */
export async function handleChatTurn(
  params: HandleChatTurnParams,
  runnerOpts: RunnerOptions = {},
): Promise<HandleChatTurnResult> {
  const agentId = params.agentId?.trim() || DEFAULT_AGENT_ID;
  const session = await resolveSession(params, agentId);
  const userContent = buildUserMessage(params);

  await appendMessage({
    sessionId: session.id,
    role: 'user',
    content: userContent,
  });

  const invocation: AgentInvocation = await startInvocation({
    trigger: 'user_chat',
    agentId,
    sessionId: session.id,
    model: DEFAULT_MODEL,
  });

  try {
    await run(
      {
        invocationId: invocation.id,
        sessionId: session.id,
        agentId,
        model: DEFAULT_MODEL,
        initialUserMessage: userContent,
        onEvent: params.onEvent,
      },
      runnerOpts,
    );
  } catch {
    // The runner has already emitted an `error` event and called
    // failInvocation; swallow so the caller can still return a clean 200
    // with the invocation id. Raw errors aren't useful to the HTTP caller
    // — they've already been delivered via the SSE/event channel.
  }

  return {
    sessionId: session.id,
    agentId,
    invocationId: invocation.id,
  };
}

export interface BufferedChatTurnResult extends HandleChatTurnResult {
  reply: string;
}

const ERROR_CODE_STATUS: Record<AgentEventErrorCode, number> = {
  gateway_unreachable: 503,
  daily_cap_exceeded: 429,
  timeout: 504,
  cancelled: 499,
  transport: 503,
  agent: 500,
};

/**
 * Buffered wrapper around `handleChatTurn`. Captures fatal error events and
 * rethrows them as `AppError` with an appropriate status; on success, reads
 * back the finalized assistant messages for this invocation and returns them
 * joined as `reply`. Used by `POST /api/chat` and the MCP `chat.send_message`
 * bridge so non-streaming callers get the same shape they had in Phase 1.
 */
export async function runBufferedChatTurn(
  params: Omit<HandleChatTurnParams, 'onEvent'>,
  runnerOpts: RunnerOptions = {},
): Promise<BufferedChatTurnResult> {
  let fatal: { message: string; code?: AgentEventErrorCode } | null = null;
  const turn = await handleChatTurn(
    {
      ...params,
      onEvent: (e) => {
        if (e.type === 'error' && e.fatal && !fatal) {
          fatal = { message: e.error, code: e.code };
        }
      },
    },
    runnerOpts,
  );

  if (fatal) {
    const err = fatal as { message: string; code?: AgentEventErrorCode };
    const status = err.code ? ERROR_CODE_STATUS[err.code] ?? 500 : 500;
    throw new AppError(status, err.message, {
      code: err.code,
      invocationId: turn.invocationId,
      sessionId: turn.sessionId,
    });
  }

  const detail = await getInvocation(turn.invocationId);
  const reply = detail.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content ?? '')
    .join('\n\n')
    .trim();

  return {
    ...turn,
    reply: reply || 'No response from agent.',
  };
}
