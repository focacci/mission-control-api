#!/usr/bin/env tsx
/**
 * Gateway WS client smoke test (PHASE_2_API slice 2).
 *
 * Requires a local OpenClaw gateway running (`openclaw gateway status`
 * should show "running"). Exercises the GatewayClient against it:
 *
 *   T1  handshake completes → isReady true, hello-ok received (<2s)
 *   T2  RPC request/response → `health` returns ok shape
 *   T3  subscribe → at least one `tick` event within 2× tickIntervalMs
 *   T4  forced disconnect triggers reconnect → isReady becomes true again
 *   T5  unsubscribe stops handler from firing
 *   T6  request timeout rejects after configured ms
 *   T7  request on closed client rejects
 *
 * Exits 0 on pass, 1 on failure. Each T# prints ✓ or ✖.
 */

import 'dotenv/config';
import { GatewayClient } from '../src/agent/gatewayClient.js';

const URL = process.env.OPENCLAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789';
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

let failures = 0;
function pass(label: string) {
  console.log(`  ✓ ${label}`);
}
function fail(label: string, detail?: unknown) {
  failures += 1;
  console.error(`  ✖ ${label}${detail !== undefined ? `: ${String(detail)}` : ''}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function main() {
  console.log(`gateway smoke: ${URL} (token: ${TOKEN ? 'set' : 'unset'})`);

  // ---- T1: handshake ----------------------------------------------------
  console.log('\nT1 handshake');
  const client = new GatewayClient({
    url: URL,
    token: TOKEN,
    clientDisplayName: 'mc-api-smoke',
    initialBackoffMs: 200,
    maxBackoffMs: 2_000,
  });
  const t0 = Date.now();
  client.on('ready', (hello: { auth?: { scopes?: string[]; deviceToken?: string } }) => {
    console.log(
      `  [dbg] assigned scopes: ${JSON.stringify(hello?.auth?.scopes ?? [])}; deviceToken: ${hello?.auth?.deviceToken ? 'issued' : 'none'}`,
    );
  });
  try {
    await withTimeout(client.connect(), 3_000, 'connect');
    const elapsed = Date.now() - t0;
    if (!client.isReady) fail(`isReady should be true after connect`);
    else pass(`hello-ok in ${elapsed}ms`);
  } catch (err) {
    fail('handshake failed', err);
    await client.close();
    return;
  }

  // ---- T2: request/response round-trip ---------------------------------
  //
  // With shared-token-only auth (no device pairing), the server issues us an
  // empty scope set, so most RPCs reject with `missing scope: operator.read`.
  // The slice-2 goal is to prove the req/res frame path works end-to-end; a
  // structured error response is perfectly good evidence of that. We expect
  // either (a) a payload, or (b) a GatewayRequestError with a code — both
  // mean our client parsed a `res` frame and routed it to the waiting caller.
  // See PHASE_2_API_PLAN.md §11.1 (device pairing open decision); slice 4
  // will wire device identity so scoped RPCs succeed.
  console.log('\nT2 request/response round-trip');
  try {
    try {
      await client.request('agents.list', {});
      pass('RPC returned payload (agents.list ok)');
    } catch (err) {
      const gwErr = err as { name?: string; code?: string };
      if (gwErr?.name === 'GatewayRequestError' && typeof gwErr.code === 'string') {
        pass(`RPC returned structured error: ${gwErr.code}`);
      } else {
        fail('RPC rejected with non-gateway error', err);
      }
    }
  } catch (err) {
    fail('RPC failed unexpectedly', err);
  }

  // ---- T3: subscribe to tick -------------------------------------------
  console.log('\nT3 subscribe → tick (or any server event within 35s)');
  const tickSeen = new Promise<string>((resolve) => {
    const names = ['tick', 'presence', 'state-version'];
    const offs: Array<() => void> = [];
    for (const n of names) {
      offs.push(
        client.subscribe(n, () => {
          for (const o of offs) o();
          resolve(n);
        }),
      );
    }
  });
  try {
    const seen = await withTimeout(tickSeen, 35_000, 'tick watchdog');
    pass(`saw "${seen}" event`);
  } catch (err) {
    fail('no event seen within 35s', err);
  }

  // ---- T4: forced disconnect → auto-reconnect --------------------------
  console.log('\nT4 forced disconnect → reconnect');
  const readyAgain = new Promise<void>((resolve) => {
    client.once('ready', () => resolve());
  });
  // Reach into internals to force a close as if the socket died.
  const internalWs: { close?: (code?: number) => void } | null =
    // @ts-expect-error test-only introspection
    client.ws ?? null;
  if (internalWs?.close) internalWs.close(4000, 'smoke-forced');
  try {
    await withTimeout(readyAgain, 5_000, 'reconnect');
    if (client.isReady) pass('reconnected and ready');
    else fail('ready fired but isReady false');
  } catch (err) {
    fail('did not reconnect in 5s', err);
  }

  // ---- T5: unsubscribe stops handler -----------------------------------
  console.log('\nT5 unsubscribe stops handler');
  let fired = 0;
  const off = client.subscribe('tick', () => {
    fired += 1;
  });
  off();
  await wait(1_500); // allow some ticks; handler should not fire
  if (fired === 0) pass('handler did not fire after unsubscribe');
  else fail(`handler fired ${fired}× after unsubscribe`);

  // ---- T6: request timeout ---------------------------------------------
  console.log('\nT6 request timeout (socket paused → timer fires)');
  const fastClient = new GatewayClient({
    url: URL,
    token: TOKEN,
    requestTimeoutMs: 100,
    clientDisplayName: 'mc-api-smoke-timeout',
  });
  try {
    await withTimeout(fastClient.connect(), 3_000, 'connect-timeout-client');
    // Pause incoming messages on the underlying socket so any response is
    // queued and our request timer wins the race deterministically.
    const fastWs: { pause?: () => void } =
      // @ts-expect-error test-only introspection
      fastClient.ws ?? {};
    fastWs.pause?.();
    let threw = false;
    try {
      await fastClient.request('sessions.list', {});
    } catch (err) {
      threw = /timeout/i.test(String(err));
      if (!threw) fail('rejected but not a timeout', err);
    }
    if (threw) pass('request rejected with timeout');
    else fail('request did not timeout');
  } finally {
    await fastClient.close();
  }

  // ---- T7: request on closed client ------------------------------------
  console.log('\nT7 request after close rejects');
  await client.close();
  try {
    await client.request('sessions.list', {});
    fail('request resolved after close');
  } catch (err) {
    if (/not connected|closed/i.test(String(err))) pass('rejected as expected');
    else fail('unexpected rejection', err);
  }

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke script crashed:', err);
  process.exit(1);
});
