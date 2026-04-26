#!/usr/bin/env tsx
/**
 * Runner event-mapper smoke test (PHASE_2_API slice 4).
 *
 * Feeds canned gateway `agent` events into the runner through a fake
 * `RunnerGateway` and asserts:
 *
 *   T1  multi-cycle mapping: a 2-tool-use fixture produces events in the
 *       plan-mandated order: session_started → text_delta → tool_use →
 *       tool_result → message_complete → text_delta → tool_use →
 *       tool_result → message_complete → done
 *   T2  chat_messages has one assistant row per block, monotonic sortOrder,
 *       correct invocationId
 *   T3  tool_call_log rows carry the right messageId (from the assistant
 *       block that emitted the call) and a populated summary
 *   T4  agent_invocations.gateway_run_id is populated
 *   T5  lifecycle.error emits `error { fatal: true, code: 'agent' }` and
 *       marks the invocation as status='error'
 *   T6  cancel-shape error (`message: 'aborted'`) maps to
 *       code: 'cancelled' and status='cancelled'
 *   T7  AGENT_DAILY_TOKEN_CAP override blocks the run before RPC dispatch,
 *       emitting error { code: 'daily_cap_exceeded' }
 *
 * Uses an isolated SQLite file (DB_PATH) so it does not touch the dev DB.
 * Migrations are applied programmatically before any test runs.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, asc, eq } from 'drizzle-orm';

// --- Isolate DB before importing any service -----------------------------

const tmpDbDir = join(tmpdir(), `mc-runner-smoke-${Date.now()}`);
mkdirSync(tmpDbDir, { recursive: true });
const tmpDbPath = join(tmpDbDir, 'runner-smoke.db');
process.env.DB_PATH = tmpDbPath;
process.env.AGENT_DAILY_TOKEN_CAP = process.env.AGENT_DAILY_TOKEN_CAP ?? '2000000';

// Apply migrations against the fresh DB.
{
  const sqlite = new Database(tmpDbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: './drizzle/migrations' });
  sqlite.close();
}

// Now load modules — they'll pick up DB_PATH.
const [{ db }, schema, conv, inv, runnerMod] = await Promise.all([
  import('../src/db/client.js'),
  import('../src/db/schema.js'),
  import('../src/services/conversations.service.js'),
  import('../src/services/invocations.service.js'),
  import('../src/agent/runner.js'),
]);
const { run } = runnerMod;
type RunnerGateway = import('../src/agent/runner.js').RunnerGateway;
type AgentEvent = import('../src/agent/events.js').AgentEvent;

// --- Test harness --------------------------------------------------------

let failures = 0;
function pass(label: string) {
  console.log(`  ✓ ${label}`);
}
function fail(label: string, detail?: unknown) {
  failures += 1;
  console.error(`  ✖ ${label}${detail !== undefined ? `: ${String(detail)}` : ''}`);
}

function assertEq<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Build a gateway event payload as emitted by OpenClaw's agent runtime. */
function agentEvent(runId: string, stream: string, data: Record<string, unknown>) {
  return { runId, stream, data, seq: 0, ts: Date.now() };
}

/**
 * Fake gateway that captures `agent` RPC params, returns a runId, and lets the
 * caller drive the event stream manually. `driver` is called once subscribe
 * has wired up so it can push events synchronously in order.
 */
function createFakeGateway(runId: string, driver: (emit: (e: unknown) => void) => void): {
  gateway: RunnerGateway;
  requestParams: { method: string; params: unknown }[];
} {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const requestParams: { method: string; params: unknown }[] = [];
  const gateway: RunnerGateway = {
    isReady: true,
    request: async (method, params) => {
      requestParams.push({ method, params });
      if (method === 'agent') return { runId } as unknown as never;
      throw new Error(`unexpected RPC: ${method}`);
    },
    subscribe: (eventName, handler) => {
      let set = handlers.get(eventName);
      if (!set) { set = new Set(); handlers.set(eventName, set); }
      set.add(handler);
      // Schedule the driver AFTER the agent RPC has resolved (microtask).
      queueMicrotask(() => {
        queueMicrotask(() => {
          const emit = (payload: unknown) => {
            for (const h of handlers.get(eventName) ?? []) h(payload);
          };
          driver(emit);
        });
      });
      return () => { handlers.get(eventName)?.delete(handler); };
    },
  };
  return { gateway, requestParams };
}

async function setupSession(contextType: string) {
  const session = await conv.findOrCreateSession({
    agentId: 'intella',
    contextType,
    contextId: null,
  });
  const invocation = await inv.startInvocation({
    trigger: 'user_chat',
    agentId: 'intella',
    sessionId: session.id,
    model: 'claude-sonnet-4-6',
  });
  return { session, invocation };
}

// --- T1-T4: multi-cycle mapping + DB correctness -------------------------

async function testMultiCycle() {
  console.log('T1-T4: multi-cycle tool-use mapping');
  const runId = 'run-multi-cycle';
  const { session, invocation } = await setupSession('test-multi-cycle');

  const { gateway, requestParams } = createFakeGateway(runId, (emit) => {
    // Cycle 1: text → tool.start → tool.result (flush #1)
    emit(agentEvent(runId, 'lifecycle', { phase: 'start', startedAt: Date.now() }));
    emit(agentEvent(runId, 'assistant', { delta: 'Let me check the board. ', text: 'Let me check the board. ' }));
    emit(agentEvent(runId, 'tool', {
      phase: 'start',
      name: 'mission-control__board',
      toolCallId: 'tc-1',
      args: {},
    }));
    emit(agentEvent(runId, 'tool', {
      phase: 'result',
      name: 'mission-control__board',
      toolCallId: 'tc-1',
      isError: false,
      result: { goals: [{ id: 'g1' }, { id: 'g2' }], stats: { initiatives: 5, tasks: 12 } },
      durationMs: 42,
    }));
    // Cycle 2: text → tool.start → tool.result (flush #2)
    emit(agentEvent(runId, 'assistant', { delta: 'And the tasks. ', text: 'And the tasks. ' }));
    emit(agentEvent(runId, 'tool', {
      phase: 'start',
      name: 'mission-control__tasks',
      toolCallId: 'tc-2',
      args: { action: 'list', status: 'pending' },
    }));
    emit(agentEvent(runId, 'tool', {
      phase: 'result',
      name: 'mission-control__tasks',
      toolCallId: 'tc-2',
      isError: false,
      result: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      durationMs: 17,
    }));
    // Lifecycle end with token usage.
    emit(agentEvent(runId, 'lifecycle', {
      phase: 'end',
      endedAt: Date.now(),
      usage: { tokensIn: 1234, tokensOut: 567 },
    }));
  });

  const events: AgentEvent[] = [];
  const result = await run(
    {
      invocationId: invocation.id,
      sessionId: session.id,
      agentId: 'intella',
      initialUserMessage: 'show me the board and pending tasks',
      onEvent: (e) => { events.push(e); },
    },
    { gateway },
  );

  // T1: event ordering
  const types = events.map(e => e.type);
  assertEq(types, [
    'session_started',
    'text_delta',
    'tool_use',
    'tool_result',
    'message_complete',
    'text_delta',
    'tool_use',
    'tool_result',
    'message_complete',
    'done',
  ], 'T1 event order matches plan §10');

  // T1b: session_started carries our ids
  const started = events[0] as Extract<AgentEvent, { type: 'session_started' }>;
  assertEq(started.sessionId, session.id, 'T1 session_started.sessionId');
  assertEq(started.invocationId, invocation.id, 'T1 session_started.invocationId');
  assertEq(started.runId, runId, 'T1 session_started.runId');

  // T1c: tool_result carries summary from presenter
  const toolResult1 = events.find(e => e.type === 'tool_result' && e.id === 'tc-1') as Extract<AgentEvent, { type: 'tool_result' }>;
  if (toolResult1?.summary && toolResult1.summary.includes('goal')) pass('T1 board presenter summary populated');
  else fail('T1 board presenter summary populated', toolResult1?.summary);
  const toolResult2 = events.find(e => e.type === 'tool_result' && e.id === 'tc-2') as Extract<AgentEvent, { type: 'tool_result' }>;
  if (toolResult2?.summary && toolResult2.summary.includes('task')) pass('T1 tasks presenter summary populated');
  else fail('T1 tasks presenter summary populated', toolResult2?.summary);

  // T1d: done carries tokens from lifecycle.end
  assertEq(result.tokensIn, 1234, 'T1 tokensIn from lifecycle.end');
  assertEq(result.tokensOut, 567, 'T1 tokensOut from lifecycle.end');

  // T1e: agent RPC dispatched once with our sessionKey
  assertEq(requestParams.length, 1, 'T1 agent RPC dispatched once');
  const rp = (requestParams[0].params ?? {}) as Record<string, unknown>;
  assertEq(rp.sessionKey, session.id, 'T1 agent RPC sessionKey');
  assertEq(rp.agentId, 'intella', 'T1 agent RPC agentId');

  // T2: chat_messages rows
  const msgs = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, session.id))
    .orderBy(asc(schema.chatMessages.sortOrder));
  // row 0 is the pre-seeded user message (none in this harness — we skipped).
  const assistantMsgs = msgs.filter(m => m.role === 'assistant');
  assertEq(assistantMsgs.length, 2, 'T2 two assistant messages persisted');
  assertEq(assistantMsgs[0].content, 'Let me check the board. ', 'T2 assistant #1 content');
  assertEq(assistantMsgs[1].content, 'And the tasks. ', 'T2 assistant #2 content');
  if (assistantMsgs[0].invocationId === invocation.id && assistantMsgs[1].invocationId === invocation.id) {
    pass('T2 both assistant messages linked to invocation');
  } else {
    fail('T2 both assistant messages linked to invocation', { a1: assistantMsgs[0].invocationId, a2: assistantMsgs[1].invocationId });
  }
  if (assistantMsgs[0].sortOrder < assistantMsgs[1].sortOrder) pass('T2 assistant sortOrder monotonic');
  else fail('T2 assistant sortOrder monotonic', { a1: assistantMsgs[0].sortOrder, a2: assistantMsgs[1].sortOrder });

  // T3: tool_call_log
  const toolRows = await db
    .select()
    .from(schema.toolCallLog)
    .where(eq(schema.toolCallLog.invocationId, invocation.id))
    .orderBy(asc(schema.toolCallLog.startedAt));
  assertEq(toolRows.length, 2, 'T3 two tool_call_log rows');
  assertEq(toolRows[0].toolName, 'mission-control__board', 'T3 tool #1 name');
  assertEq(toolRows[1].toolName, 'mission-control__tasks', 'T3 tool #2 name');
  assertEq(toolRows[0].messageId, assistantMsgs[0].id, 'T3 tool #1 messageId points to assistant #1');
  assertEq(toolRows[1].messageId, assistantMsgs[1].id, 'T3 tool #2 messageId points to assistant #2');
  if (toolRows[0].summary && toolRows[0].summary.includes('goal')) pass('T3 tool #1 summary persisted');
  else fail('T3 tool #1 summary persisted', toolRows[0].summary);
  if (toolRows[1].summary && toolRows[1].summary.includes('task')) pass('T3 tool #2 summary persisted');
  else fail('T3 tool #2 summary persisted', toolRows[1].summary);
  assertEq(toolRows[0].durationMs, 42, 'T3 tool #1 durationMs from gateway');
  assertEq(toolRows[1].durationMs, 17, 'T3 tool #2 durationMs from gateway');

  // T4: agent_invocations.gateway_run_id
  const [invRow] = await db
    .select()
    .from(schema.agentInvocations)
    .where(eq(schema.agentInvocations.id, invocation.id));
  assertEq(invRow.gatewayRunId, runId, 'T4 gateway_run_id persisted');
  assertEq(invRow.status, 'complete', 'T4 invocation status=complete');
  assertEq(invRow.tokensIn, 1234, 'T4 tokensIn persisted');
  assertEq(invRow.tokensOut, 567, 'T4 tokensOut persisted');
}

// --- T5: lifecycle.error -------------------------------------------------

async function testError() {
  console.log('T5: lifecycle.error');
  const runId = 'run-error';
  const { session, invocation } = await setupSession('test-error');

  const { gateway } = createFakeGateway(runId, (emit) => {
    emit(agentEvent(runId, 'lifecycle', { phase: 'start', startedAt: Date.now() }));
    emit(agentEvent(runId, 'assistant', { delta: 'Working on it…', text: 'Working on it…' }));
    emit(agentEvent(runId, 'lifecycle', {
      phase: 'error',
      endedAt: Date.now(),
      error: 'provider returned 500',
    }));
  });

  const events: AgentEvent[] = [];
  try {
    await run(
      {
        invocationId: invocation.id,
        sessionId: session.id,
        agentId: 'intella',
        initialUserMessage: 'hi',
        onEvent: (e) => { events.push(e); },
      },
      { gateway },
    );
    fail('T5 run should have rejected');
  } catch {
    pass('T5 run rejected on lifecycle.error');
  }

  const errEvt = events.find(e => e.type === 'error') as Extract<AgentEvent, { type: 'error' }> | undefined;
  if (errEvt && errEvt.fatal && errEvt.code === 'agent' && errEvt.error.includes('500')) {
    pass('T5 error event fatal + code=agent + message carries provider detail');
  } else {
    fail('T5 error event', errEvt);
  }

  const [invRow] = await db
    .select()
    .from(schema.agentInvocations)
    .where(eq(schema.agentInvocations.id, invocation.id));
  assertEq(invRow.status, 'error', 'T5 invocation status=error');
}

// --- T6: cancel ----------------------------------------------------------

async function testCancel() {
  console.log('T6: cancel via lifecycle error');
  const runId = 'run-cancel';
  const { session, invocation } = await setupSession('test-cancel');

  const { gateway } = createFakeGateway(runId, (emit) => {
    emit(agentEvent(runId, 'lifecycle', { phase: 'start', startedAt: Date.now() }));
    emit(agentEvent(runId, 'assistant', { delta: 'Thinking…', text: 'Thinking…' }));
    emit(agentEvent(runId, 'lifecycle', {
      phase: 'error',
      endedAt: Date.now(),
      error: 'run aborted by client',
    }));
  });

  const events: AgentEvent[] = [];
  try {
    await run(
      {
        invocationId: invocation.id,
        sessionId: session.id,
        agentId: 'intella',
        initialUserMessage: 'hi',
        onEvent: (e) => { events.push(e); },
      },
      { gateway },
    );
    fail('T6 run should have rejected');
  } catch {
    pass('T6 run rejected on cancel');
  }

  const errEvt = events.find(e => e.type === 'error') as Extract<AgentEvent, { type: 'error' }> | undefined;
  assertEq(errEvt?.code, 'cancelled', 'T6 error code=cancelled');

  const [invRow] = await db
    .select()
    .from(schema.agentInvocations)
    .where(eq(schema.agentInvocations.id, invocation.id));
  assertEq(invRow.status, 'cancelled', 'T6 invocation status=cancelled');
}

// --- T7: daily cap -------------------------------------------------------

async function testDailyCap() {
  console.log('T7: AGENT_DAILY_TOKEN_CAP pre-check');
  const runId = 'run-capped';
  const { session, invocation } = await setupSession('test-cap');

  // Any event would be wrong — run() must block BEFORE RPC dispatch.
  let rpcCalled = false;
  const gateway: RunnerGateway = {
    isReady: true,
    request: async () => { rpcCalled = true; return { runId } as never; },
    subscribe: () => () => { /* no-op */ },
  };

  const events: AgentEvent[] = [];
  const result = await run(
    {
      invocationId: invocation.id,
      sessionId: session.id,
      agentId: 'intella',
      initialUserMessage: 'hi',
      onEvent: (e) => { events.push(e); },
    },
    { gateway, dailyTokenCap: 1 }, // force over-cap
  );

  assertEq(rpcCalled, false, 'T7 gateway.request NOT called when capped');
  assertEq(events.length, 1, 'T7 exactly one event emitted');
  const errEvt = events[0] as Extract<AgentEvent, { type: 'error' }>;
  assertEq(errEvt.type, 'error', 'T7 event type=error');
  assertEq(errEvt.code, 'daily_cap_exceeded', 'T7 error code');
  assertEq(errEvt.fatal, true, 'T7 error fatal');
  assertEq(result.tokensIn, 0, 'T7 no tokens counted');

  const [invRow] = await db
    .select()
    .from(schema.agentInvocations)
    .where(eq(schema.agentInvocations.id, invocation.id));
  assertEq(invRow.status, 'error', 'T7 invocation status=error');
}

// --- Run -----------------------------------------------------------------

async function main() {
  console.log(`runner mapper smoke: DB_PATH=${tmpDbPath}`);
  try {
    await testMultiCycle();
    await testError();
    await testCancel();
    await testDailyCap();
  } finally {
    // Best-effort cleanup.
    try { rmSync(tmpDbDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (failures > 0) {
    console.error(`\nFAIL: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log(`\nOK: all assertions passed`);
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal:', err);
  if (existsSync(tmpDbDir)) try { rmSync(tmpDbDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
