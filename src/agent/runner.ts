import { nanoid } from 'nanoid';
import { appendMessage } from '../services/conversations.service.js';
import {
  completeInvocation,
  failInvocation,
  getTodayTokenUsage,
  setInvocationRunId,
} from '../services/invocations.service.js';
import { drainParts } from '../services/pendingParts.service.js';
import {
  backfillToolCallMessageIds,
  recordToolCallResult,
  recordToolCallStart,
} from '../services/toolCalls.service.js';
import { getGatewayClient, GatewayRequestError } from './gatewayClient.js';
import type { AgentEvent, AgentEventErrorCode } from './events.js';
import { summarize } from './presenters.js';
import { buildSystemPrompt } from './systemPrompt.js';
import type { MessagePart } from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunAgentParams {
  invocationId: string;
  sessionId: string;
  agentId: string;
  model?: string;
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  timeoutSeconds?: number;
  systemPromptAdditions?: string;
  initialUserMessage: string;
  onEvent: (e: AgentEvent) => void;
}

export interface RunAgentResult {
  tokensIn: number;
  tokensOut: number;
}

/**
 * Minimal gateway surface used by the runner. The production implementation is
 * the `GatewayClient` singleton; the fixture test injects its own.
 */
export interface RunnerGateway {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  subscribe(eventName: string, handler: (payload: unknown) => void): () => void;
  readonly isReady: boolean;
}

export interface RunnerOptions {
  gateway?: RunnerGateway;
  /** Default cap: 2,000,000 tokens per UTC day (matches CONTROL_LAYER_PLAN.md). */
  dailyTokenCap?: number;
  /** Override the user message persisted on the session (defaults to `initialUserMessage`). */
  skipUserMessageAppend?: boolean;
}

const DEFAULT_DAILY_TOKEN_CAP = Number(
  process.env.AGENT_DAILY_TOKEN_CAP ?? 2_000_000,
);

export async function run(
  params: RunAgentParams,
  opts: RunnerOptions = {},
): Promise<RunAgentResult> {
  const gateway = opts.gateway ?? getGatewayClient();
  const cap = opts.dailyTokenCap ?? DEFAULT_DAILY_TOKEN_CAP;

  // --- 1. Pre-flight: daily token cap ------------------------------------
  const usedToday = await getTodayTokenUsage();
  if (cap > 0 && usedToday >= cap) {
    const msg = `daily token cap reached (${usedToday} >= ${cap})`;
    params.onEvent({ type: 'error', error: msg, code: 'daily_cap_exceeded', fatal: true });
    await failInvocation(params.invocationId, { error: msg, status: 'error' });
    return { tokensIn: 0, tokensOut: 0 };
  }

  // --- 2. Gateway readiness -----------------------------------------------
  if (!gateway.isReady) {
    const msg = 'gateway not connected';
    params.onEvent({ type: 'error', error: msg, code: 'gateway_unreachable', fatal: true });
    await failInvocation(params.invocationId, { error: msg, status: 'error' });
    return { tokensIn: 0, tokensOut: 0 };
  }

  // --- 3. Wire up the reducer before dispatching the RPC ------------------
  return new Promise<RunAgentResult>((resolve, reject) => {
    const state: ReducerState = {
      invocationId: params.invocationId,
      sessionId: params.sessionId,
      runId: null,
      assistantBuffer: '',
      currentMessageId: null,
      emittedSessionStarted: false,
      totals: { in: 0, out: 0 },
      settling: false,
      settled: false,
    };

    const unsubscribes: Array<() => void> = [];
    const cleanup = () => {
      for (const u of unsubscribes) {
        try { u(); } catch { /* ignore */ }
      }
    };

    // Events may arrive before the `agent` RPC resolves with our runId. Buffer
    // raw payloads and replay (filtered by runId) once we know it. A single
    // promise chain serializes reducer dispatch so prelude drain and live
    // events don't interleave.
    const prelude: unknown[] = [];
    let queueTail: Promise<void> = Promise.resolve();
    const enqueue = (fn: () => Promise<void>) => {
      queueTail = queueTail.then(fn).catch(err => {
        console.warn(`[runner] queued task threw: ${String(err)}`);
      });
      return queueTail;
    };

    const emit = (event: AgentEvent) => {
      if (state.settled) return;
      try { params.onEvent(event); }
      catch (err) { console.warn(`[runner] onEvent handler threw: ${String(err)}`); }
    };

    const settleOk = async () => {
      if (state.settling) return;
      state.settling = true;
      cleanup();
      // Flush any pending assistant buffer as a message before `done`.
      await flushAssistantBuffer(state, emit);
      await completeInvocation(params.invocationId, {
        tokensIn: state.totals.in,
        tokensOut: state.totals.out,
      });
      emit({ type: 'done', tokensIn: state.totals.in, tokensOut: state.totals.out });
      state.settled = true;
      resolve({ tokensIn: state.totals.in, tokensOut: state.totals.out });
    };

    const settleErr = async (
      error: string,
      code: AgentEventErrorCode = 'agent',
      status: 'error' | 'timeout' | 'cancelled' = 'error',
    ) => {
      if (state.settling) return;
      state.settling = true;
      cleanup();
      emit({ type: 'error', error, code, fatal: true });
      try {
        await failInvocation(params.invocationId, {
          error,
          status,
          tokensIn: state.totals.in,
          tokensOut: state.totals.out,
        });
      } catch (err) {
        console.warn(`[runner] failInvocation threw: ${String(err)}`);
      }
      state.settled = true;
      reject(new Error(error));
    };

    const processOne = async (payload: unknown) => {
      if (state.settling) return;
      if (!state.runId) {
        prelude.push(payload);
        return;
      }
      const evt = normalizeGatewayEvent(payload);
      if (!evt) return;
      if (evt.runId !== state.runId) return;
      try {
        await reduce(evt, state, emit, settleOk, settleErr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await settleErr(`reducer error: ${msg}`);
      }
    };

    const drainPrelude = async () => {
      const buffered = prelude.splice(0, prelude.length);
      for (const p of buffered) {
        if (state.settling) return;
        const evt = normalizeGatewayEvent(p);
        if (!evt) continue;
        if (evt.runId !== state.runId) continue;
        try {
          await reduce(evt, state, emit, settleOk, settleErr);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await settleErr(`reducer error: ${msg}`);
          return;
        }
      }
    };

    unsubscribes.push(gateway.subscribe('agent', (p) => { void enqueue(() => processOne(p)); }));

    // --- 4. Dispatch the RPC --------------------------------------------
    // Gateway schema requires `idempotencyKey`; `extraSystemPrompt` is the
    // real field name (not `systemPrompt`); `timeout` is integer seconds.
    // Gateway sessionKey must be `agent:<agentId>:<rest>` — otherwise the
    // server defaults routing to agent "main" and rejects the call as a
    // mismatched agent.
    const extraSystemPrompt = buildSystemPrompt(params.agentId, params.systemPromptAdditions);
    const rpcParams: Record<string, unknown> = {
      sessionKey: `agent:${params.agentId}:mc-${params.sessionId}`,
      agentId: params.agentId,
      message: params.initialUserMessage,
      extraSystemPrompt,
      idempotencyKey: params.invocationId,
    };
    if (params.model) rpcParams.model = params.model;
    if (params.thinking) rpcParams.thinking = params.thinking;
    if (params.timeoutSeconds) rpcParams.timeout = params.timeoutSeconds;

    gateway
      .request<{ runId: string }>('agent', rpcParams)
      .then(async (res) => {
        if (state.settling) return;
        if (!res || typeof res.runId !== 'string') {
          await settleErr('agent RPC returned no runId');
          return;
        }
        state.runId = res.runId;
        try { await setInvocationRunId(params.invocationId, res.runId); }
        catch (err) { console.warn(`[runner] setInvocationRunId: ${String(err)}`); }
        if (!state.emittedSessionStarted) {
          state.emittedSessionStarted = true;
          emit({
            type: 'session_started',
            sessionId: params.sessionId,
            invocationId: params.invocationId,
            runId: res.runId,
          });
        }
        await enqueue(drainPrelude);
      })
      .catch(async (err: unknown) => {
        const msg = err instanceof GatewayRequestError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
        const code: AgentEventErrorCode = err instanceof GatewayRequestError ? 'agent' : 'transport';
        await settleErr(`agent RPC failed: ${msg}`, code);
      });
  });
}

// ---------------------------------------------------------------------------
// Reducer — exported for the fixture smoke test
// ---------------------------------------------------------------------------

export interface ReducerState {
  invocationId: string;
  sessionId: string;
  runId: string | null;
  assistantBuffer: string;
  currentMessageId: string | null;
  emittedSessionStarted: boolean;
  totals: { in: number; out: number };
  settling: boolean;
  settled: boolean;
}

export interface NormalizedGatewayEvent {
  runId: string;
  stream: string;
  data: Record<string, unknown>;
}

export function normalizeGatewayEvent(payload: unknown): NormalizedGatewayEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.runId !== 'string' || typeof obj.stream !== 'string') return null;
  const data = (obj.data && typeof obj.data === 'object' ? obj.data : {}) as Record<string, unknown>;
  return { runId: obj.runId, stream: obj.stream, data };
}

export async function reduce(
  evt: NormalizedGatewayEvent,
  state: ReducerState,
  emit: (e: AgentEvent) => void,
  onEnd: () => Promise<void>,
  onError: (error: string, code?: AgentEventErrorCode, status?: 'error' | 'timeout' | 'cancelled') => Promise<void>,
): Promise<void> {
  switch (evt.stream) {
    case 'lifecycle': {
      const phase = stringField(evt.data, 'phase');
      if (phase === 'start') {
        // `session_started` is emitted once the RPC resolves with a runId.
        // Nothing to do here; some providers emit lifecycle.start a beat later.
        return;
      }
      if (phase === 'end') {
        // Token usage, if provided, ships on the lifecycle.end payload.
        applyTokens(state, evt.data);
        await onEnd();
        return;
      }
      if (phase === 'error') {
        const errMsg = stringField(evt.data, 'error') ?? 'agent lifecycle error';
        const code = classifyErrorCode(errMsg);
        const status = code === 'cancelled' ? 'cancelled' : code === 'timeout' ? 'timeout' : 'error';
        await onError(errMsg, code, status);
        return;
      }
      return;
    }

    case 'assistant': {
      const delta = stringField(evt.data, 'delta');
      const text = stringField(evt.data, 'text');
      const replace = boolField(evt.data, 'replace');

      // `text` is the cumulative block text; `delta` is the increment. We
      // prefer delta when present (streaming updates). If only `text` is
      // given with `replace: true`, we discard any buffer and start fresh.
      if (replace && typeof text === 'string') {
        state.assistantBuffer = text;
        if (text.length > 0) emit({ type: 'text_delta', text });
        return;
      }
      if (typeof delta === 'string' && delta.length > 0) {
        state.assistantBuffer += delta;
        emit({ type: 'text_delta', text: delta });
        return;
      }
      if (typeof text === 'string' && text.length > 0 && text !== state.assistantBuffer) {
        const increment = text.startsWith(state.assistantBuffer)
          ? text.slice(state.assistantBuffer.length)
          : text;
        state.assistantBuffer = text;
        if (increment) emit({ type: 'text_delta', text: increment });
        return;
      }
      return;
    }

    case 'tool': {
      const phase = stringField(evt.data, 'phase');
      const toolName = stringField(evt.data, 'name') ?? 'unknown';
      const toolCallId = stringField(evt.data, 'toolCallId') ?? nanoid();
      if (phase === 'start') {
        // Tool calls belong to the in-flight assistant block. We defer the
        // `message_complete` flush until the tool *result* arrives so that
        // iOS sees `text_delta → tool_use → tool_result → message_complete`
        // for each cycle (plan §10 acceptance).
        const args = evt.data.args;
        await recordToolCallStart({
          id: toolCallId,
          messageId: null,
          invocationId: state.invocationId,
          toolName,
          input: args,
        });
        emit({ type: 'tool_use', id: toolCallId, name: toolName, input: args });
        return;
      }
      if (phase === 'result' || phase === 'end') {
        const isError = boolField(evt.data, 'isError') ?? false;
        const result = evt.data.result ?? evt.data.output ?? null;
        const durationMs =
          (typeof evt.data.durationMs === 'number' && Number.isFinite(evt.data.durationMs))
            ? (evt.data.durationMs as number)
            : undefined;
        const { result: summary } = summarize(toolName, evt.data.args, result, isError);
        const computedDuration = durationMs ?? 0;
        await recordToolCallResult(toolCallId, {
          output: result,
          isError,
          durationMs: computedDuration,
          summary,
        });
        emit({
          type: 'tool_result',
          id: toolCallId,
          output: result,
          isError,
          durationMs: computedDuration,
          summary,
        });
        // Close the assistant block: persist buffered text and backfill this
        // tool_call's messageId.
        await flushAssistantBuffer(state, emit);
        return;
      }
      // phase === 'update' — not surfaced in Phase 2 (partial progress).
      return;
    }

    default:
      // Unhandled streams (item, plan, approval, command_output, patch, …)
      // are ignored in Phase 2. They'll feed richer UI later.
      return;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushAssistantBuffer(
  state: ReducerState,
  emit: (e: AgentEvent) => void,
): Promise<void> {
  const text = state.assistantBuffer;
  // Drain interface-tool parts queued during this assistant block (Bucket 2b).
  // The MCP dispatcher writes to `pending_message_parts` from a separate
  // process; we pull them in insertion order and merge after the buffered text
  // so the resulting transcript message is `[text?, card?, navigate?, …]`.
  const queuedParts = await drainParts(state.invocationId);
  if (!text && queuedParts.length === 0) return;

  const parts: MessagePart[] = [];
  if (text) parts.push({ kind: 'text', text });
  parts.push(...queuedParts);

  const msg = await appendMessage({
    sessionId: state.sessionId,
    invocationId: state.invocationId,
    role: 'assistant',
    content: text,
    parts,
  });
  state.currentMessageId = msg.id;
  state.assistantBuffer = '';
  emit({ type: 'message_complete', messageId: msg.id });
  // Backfill any tool_call_log rows whose tool.start arrived before the
  // block's text — rare, but covered per plan §6.7.
  await backfillToolCallMessageIds(state.invocationId, msg.id);
}

function applyTokens(state: ReducerState, data: Record<string, unknown>): void {
  const usage = (data.usage && typeof data.usage === 'object' ? data.usage : data) as Record<string, unknown>;
  const tokensIn =
    numberField(usage, 'tokensIn') ??
    numberField(usage, 'inputTokens') ??
    numberField(usage, 'input_tokens');
  const tokensOut =
    numberField(usage, 'tokensOut') ??
    numberField(usage, 'outputTokens') ??
    numberField(usage, 'output_tokens');
  if (tokensIn !== undefined) state.totals.in = tokensIn;
  if (tokensOut !== undefined) state.totals.out = tokensOut;
}

function classifyErrorCode(msg: string): AgentEventErrorCode {
  const lower = msg.toLowerCase();
  if (lower.includes('abort') || lower.includes('cancel')) return 'cancelled';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  return 'agent';
}

function stringField(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' ? v : undefined;
}

function boolField(o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  return typeof v === 'boolean' ? v : undefined;
}

function numberField(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
