#!/usr/bin/env tsx
/**
 * Cancel-invocation smoke test (PHASE_2_API slice 7).
 *
 * Drives `cancelInvocation` directly with an injected fake gateway and
 * asserts:
 *
 *   C1  unknown id → 404 AppError
 *   C2  status !== 'running' → 409 AppError; gateway is not called
 *   C3  happy path: dispatches `sessions.abort` with runner-style sessionKey
 *       (`agent:<agentId>:mc-<sessionId>`); does NOT mutate the row (runner
 *       owns the lifecycle.error → status='cancelled' transition); response
 *       is `{ cancelled: true, reconciled: false }`
 *   C4  gateway responds with `NOT_FOUND` → reconcile path: row becomes
 *       status='cancelled' with error='stale'; response carries
 *       `reconciled: true`
 *   C5  gateway responds with an unrelated error (`INTERNAL`) → rethrows;
 *       row is untouched
 *
 * Uses an isolated SQLite DB (DB_PATH) so the dev DB is not touched.
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';

const tmpDbDir = join(tmpdir(), `mc-cancel-smoke-${Date.now()}`);
mkdirSync(tmpDbDir, { recursive: true });
const tmpDbPath = join(tmpDbDir, 'cancel-smoke.db');
process.env.DB_PATH = tmpDbPath;

{
  const sqlite = new Database(tmpDbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: './drizzle/migrations' });
  sqlite.close();
}

const [{ db }, schema, conv, inv, gw] = await Promise.all([
  import('../src/db/client.js'),
  import('../src/db/schema.js'),
  import('../src/services/conversations.service.js'),
  import('../src/services/invocations.service.js'),
  import('../src/agent/gatewayClient.js'),
]);

let failures = 0;
const pass = (label: string) => console.log(`  ✓ ${label}`);
const fail = (label: string, detail?: unknown) => {
  failures += 1;
  console.error(`  ✖ ${label}${detail !== undefined ? `: ${String(detail)}` : ''}`);
};
const assertEq = <T>(actual: T, expected: T, label: string) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

interface FakeGateway {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  calls: { method: string; params: unknown }[];
}

function makeGateway(behavior: (params: unknown) => unknown | Promise<unknown>): FakeGateway {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    request: async (method, params) => {
      calls.push({ method, params });
      const out = await behavior(params);
      return out as never;
    },
  };
}

async function setupRunningInvocation(label: string) {
  const session = await conv.findOrCreateSession({
    agentId: 'intella',
    contextType: label,
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

async function getRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.agentInvocations)
    .where(eq(schema.agentInvocations.id, id));
  return row;
}

// --- C1: 404 on unknown id -----------------------------------------------

async function testNotFound() {
  console.log('C1: 404 on unknown invocation');
  const gateway = makeGateway(() => ({}));
  try {
    await inv.cancelInvocation('does-not-exist', { gateway });
    fail('C1 throws notFound');
  } catch (err) {
    const e = err as { statusCode?: number };
    assertEq(e.statusCode, 404, 'C1 statusCode is 404');
    assertEq(gateway.calls.length, 0, 'C1 gateway not called');
  }
}

// --- C2: 409 when not running --------------------------------------------

async function testConflict() {
  console.log('C2: 409 when not running');
  const { invocation } = await setupRunningInvocation('cancel-c2');
  await inv.completeInvocation(invocation.id, { tokensIn: 10, tokensOut: 5 });
  const gateway = makeGateway(() => ({}));
  try {
    await inv.cancelInvocation(invocation.id, { gateway });
    fail('C2 throws AppError');
  } catch (err) {
    const e = err as { statusCode?: number };
    assertEq(e.statusCode, 409, 'C2 statusCode is 409');
    assertEq(gateway.calls.length, 0, 'C2 gateway not called');
  }
  const row = await getRow(invocation.id);
  assertEq(row.status, 'complete', 'C2 row still status=complete');
}

// --- C3: happy path -------------------------------------------------------

async function testHappyPath() {
  console.log('C3: happy path dispatches sessions.abort');
  const { session, invocation } = await setupRunningInvocation('cancel-c3');
  const gateway = makeGateway(() => ({ aborted: true }));

  const res = await inv.cancelInvocation(invocation.id, { gateway });
  assertEq(res, { cancelled: true, reconciled: false }, 'C3 response shape');
  assertEq(gateway.calls.length, 1, 'C3 gateway called once');
  const call = gateway.calls[0];
  assertEq(call.method, 'sessions.abort', 'C3 method is sessions.abort');
  const params = call.params as Record<string, unknown>;
  assertEq(
    params.sessionKey,
    `agent:intella:mc-${session.id}`,
    'C3 sessionKey matches runner shape',
  );

  const row = await getRow(invocation.id);
  // Runner is responsible for the cancelled transition; the route only
  // dispatches the abort, so status stays 'running' here.
  assertEq(row.status, 'running', 'C3 status untouched after happy abort');
  assertEq(row.error, null, 'C3 error column untouched');
}

// --- C4: reconcile path ---------------------------------------------------

async function testReconcile() {
  console.log('C4: reconcile when gateway says session not found');
  const { invocation } = await setupRunningInvocation('cancel-c4');
  const gateway = makeGateway(() => {
    throw new gw.GatewayRequestError('no such session', 'NOT_FOUND');
  });

  const res = await inv.cancelInvocation(invocation.id, { gateway });
  assertEq(res, { cancelled: true, reconciled: true }, 'C4 reconciled response');

  const row = await getRow(invocation.id);
  assertEq(row.status, 'cancelled', 'C4 status reconciled to cancelled');
  assertEq(row.error, 'stale', 'C4 error column = "stale"');
  if (row.endedAt) pass('C4 endedAt populated');
  else fail('C4 endedAt populated', row.endedAt);
}

// --- C5: rethrow on unrelated error --------------------------------------

async function testUnrelatedError() {
  console.log('C5: rethrow on unrelated gateway error');
  const { invocation } = await setupRunningInvocation('cancel-c5');
  const gateway = makeGateway(() => {
    throw new gw.GatewayRequestError('boom', 'INTERNAL');
  });

  try {
    await inv.cancelInvocation(invocation.id, { gateway });
    fail('C5 rethrows');
  } catch (err) {
    if (err instanceof gw.GatewayRequestError && err.code === 'INTERNAL') {
      pass('C5 GatewayRequestError rethrown');
    } else {
      fail('C5 GatewayRequestError rethrown', String(err));
    }
  }
  const row = await getRow(invocation.id);
  assertEq(row.status, 'running', 'C5 row still status=running');
  assertEq(row.error, null, 'C5 row error untouched');
}

// --- run ------------------------------------------------------------------

await testNotFound();
await testConflict();
await testHappyPath();
await testReconcile();
await testUnrelatedError();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll cancel-invocation smoke tests passed.');
process.exit(0);
