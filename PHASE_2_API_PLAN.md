# Phase 2 API Plan — Backend Support for Claude-Code-Style Chat UI

> Companion plan translating [CONTROL_LAYER_PLAN.md §5](CONTROL_LAYER_PLAN.md#5-phase-2--in-process-agent-loop) and
> [CONTROL_LAYER_PHASE_2_UI.md §7–§8](CONTROL_LAYER_PHASE_2_UI.md#7-api-additions-beyond-5-of-the-plan)
> into a concrete, PR-sized execution plan for the API side only.
>
> Rewritten 2026-04-21 to replace the earlier Anthropic-SDK-over-`baseURL` approach
> with a direct **OpenClaw Gateway WebSocket client**. See §2.1 for the shift.

## Contents

- [1. Current State](#1-current-state)
- [2. Scope of this plan](#2-scope-of-this-plan)
  - [2.1 Why Gateway WS, not Anthropic SDK](#21-why-gateway-ws-not-anthropic-sdk)
- [3. Feasibility](#3-feasibility)
- [4. Changes vs. CONTROL_LAYER_PLAN.md](#4-changes-vs-control_layer_planmd)
- [5. Target event contract (authoritative)](#5-target-event-contract-authoritative)
- [6. New modules](#6-new-modules)
- [7. New and changed routes](#7-new-and-changed-routes)
- [8. Schema / migrations](#8-schema--migrations)
- [9. PR-sized execution slices](#9-pr-sized-execution-slices)
- [10. Acceptance criteria (API-only)](#10-acceptance-criteria-api-only)
- [11. Open decisions](#11-open-decisions)
- [12. Out of scope](#12-out-of-scope)

---

## 1. Current State

Verified against the repo on 2026-04-21.

**In place (Phase 1):**

- Schema: `chat_sessions`, `agent_invocations`, `chat_messages`, `tool_call_log` — [src/db/schema.ts:154-211](src/db/schema.ts#L154-L211). `tool_call_log.summary` already exists.
- Services:
  - [src/services/conversations.service.ts](src/services/conversations.service.ts) — `findOrCreateSession`, `appendMessage` (auto-increments `sortOrder`, derives title), `listMessages`, `deleteSession`
  - [src/services/invocations.service.ts](src/services/invocations.service.ts) — `startInvocation`, `completeInvocation`, `failInvocation`, `getInvocation` (returns `{ invocation, messages, toolCalls }`), `getTodayTokenUsage`
  - [src/services/toolCalls.service.ts](src/services/toolCalls.service.ts) — `recordToolCallStart`, `recordToolCallResult` (already accepts `summary`)
- Routes: `GET /api/chat/sessions*`, `GET /api/invocations[/:id]`, `POST /api/chat` (buffered, `execFile` to `openclaw agent`)
- MCP tool surface: 6 tools (`board`, `goals`, `initiatives`, `tasks`, `schedule`, `health`) dispatched inline in [src/mcp/server.ts:19-176](src/mcp/server.ts#L19-L176)

**Missing / blocking Phase 2 UI:**

- No Gateway WS client, no `src/agent/` runtime directory
- No SSE endpoint
- No cancel endpoint
- No activity endpoint (history reconstruction joins messages + tool_calls client-side today; only `getInvocation` does this, and only per-invocation)
- No presenter layer (collapsed tool-row summaries)
- No auth middleware (orthogonal but referenced by G12)
- `chat.service.ts` still shells out to `openclaw agent --json` via `execFile`; it will be deleted once the WS runner lands

## 2. Scope of this plan

API-side only. Everything required to back:

1. Live streaming of agent activity to iOS (SSE with the event vocabulary in §5).
2. Reconstructing a past session's rich timeline (text + tool steps interleaved).
3. Aborting a running turn from iOS.
4. Surviving long tool calls and flaky mobile networks.
5. **Multi-provider agents** (Claude, Grok, Copilot, Gemini, GPT, local models) via a single code path — handled by OpenClaw's provider routing, not per-SDK shims.

iOS work is tracked in [CONTROL_LAYER_PHASE_2_UI.md](CONTROL_LAYER_PHASE_2_UI.md); this plan only lists iOS-facing contracts where the shape matters.

### 2.1 Why Gateway WS, not Anthropic SDK

The original plan proposed `@anthropic-ai/sdk` pointed at OpenClaw's Anthropic-compatible HTTP gateway. That had three costs:

1. **Provider smoke tests per model.** Every non-Anthropic provider had to be verified to round-trip Anthropic-shaped `tool_use` / `tool_result` blocks through the gateway. Any failure meant falling back to the Vercel `ai` SDK (material re-work).
2. **Wasted infrastructure.** OpenClaw already owns the agent loop — serialized per-session queue, abort signals, tool dispatch, usage accounting, skills injection, SOUL.md/bootstrap context, compaction. Running our own Anthropic loop re-implements most of that and duplicates the runtime.
3. **Provider coupling in our code.** Model names, thinking levels, and reasoning streams leak through to `runner.ts` logic.

Talking WebSocket to the Gateway directly eliminates all three. The `agent` RPC ([docs: Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)) returns `{ runId, acceptedAt }` and emits three event streams we map 1:1 onto our `AgentEvent` union:

| Gateway event | Our event |
|---|---|
| `stream: "lifecycle"` `phase: "start"` | `session_started` |
| `stream: "assistant"` delta | `text_delta` |
| `stream: "tool"` start | `tool_use` |
| `stream: "tool"` end | `tool_result` (+ server-computed summary) |
| `stream: "assistant"` block end (`text_end` / `message_end`) | `message_complete` |
| `stream: "lifecycle"` `phase: "end"` | `done` |
| `stream: "lifecycle"` `phase: "error"` | `error` |

Cancellation is `sessions.abort({ sessionKey })` — the runner no longer needs a process-wide `AbortController` registry. Timeouts are already configured on the gateway agent runtime. Multi-provider routing is `agents.list[].runtime.acp.*` + `model` overrides, set once in OpenClaw config.

**ACP was considered and rejected.** ACP is for wrapping external coding harnesses (Claude Code, Codex, Cursor, Gemini CLI) behind an IDE protocol — apply file diffs, run terminals. Mission Control's runner drives domain MCP tools (`board`, `tasks`, `schedule`) for an iOS app; forcing those through ACP means reshaping business tools as harness tools for no gain, and we lose direct access to the Gateway's tool-event stream. See [docs: ACP Agents](https://docs.openclaw.ai/tools/acp-agents).

## 3. Feasibility

**High.** The persistence foundation is already matched to what the UI needs, and the gateway surface maps cleanly onto it. What's left is:

- Build a small WS client for the Gateway protocol (connect + handshake + req/res + event subscribe + reconnect) — ~200 LOC, modeled on `openclaw/src/gateway/client.ts`.
- Build a runner that: calls `agent` RPC, subscribes to `lifecycle`/`assistant`/`tool` events for its `runId`, translates to `AgentEvent`, writes to DB.
- Add three routes: `POST /api/chat/stream`, `POST /api/invocations/:id/cancel`, `GET /api/chat/sessions/:id/activity`.
- Add a thin presenter module and persist `summary` onto `tool_call_log`.

No schema change. `tool_call_log.summary` already exists.

**Main risks**, in priority order:

1. **Tool visibility at the gateway.** Our in-process MCP tools (`board`, `tasks`, etc.) must be callable from within a gateway-run session. We expose them via `openclaw mcp serve` pointed at `src/mcp/server.ts`. **Smoke test this first** — it replaces the old Anthropic round-trip test as slice 1. One hour, unblocks everything.
2. **Tool event granularity.** `session.tool` events need enough structure (tool_use id, name, input, output, isError, durationMs) to populate `tool_call_log`. If upstream only emits coarse summaries, we fall back to the gateway's `--raw-stream` provider events. Verify before slice 3.
3. **Gateway as hard dep.** Today we fork `openclaw agent` per turn (resilient to gateway lifecycle). Tomorrow we hold a persistent WS. If the gateway is down, `/api/chat` is down. Mitigations: reconnect with backoff; return `503` with `recovery_hint` when disconnected; keep `openclaw gateway install` on boot so launchd restarts it.
4. **Auth migration.** Gateway WS uses device-token auth (paired device with `operator.read + operator.write`). We either pair Mission Control as a new device, or reuse the existing token from `~/.openclaw/openclaw.json`. One-time setup cost, no runtime risk.
5. **SSE through corporate proxies / mobile NAT.** Mitigated by the 15s heartbeat; still worth a cold-network test before calling Phase 2 done. (Unchanged from old plan.)

## 4. Changes vs. CONTROL_LAYER_PLAN.md

The parent plan's strategic decisions flip in three places:

| ID | Old decision | New decision |
|---|---|---|
| D1 | In-process Anthropic SDK + MCP loop | **In-process Gateway WS client** driving `agent` RPC. OpenClaw owns the model loop; we own session metadata + transcript projection. |
| D3 | Anthropic SDK w/ `baseURL` override → OpenClaw gateway | Drop. Gateway handles provider routing natively via agent config. |
| D4 | Mount `src/mcp/server.ts` in-process for the loop | MCP stays in-process but is exposed to the gateway via `openclaw mcp serve`. Tools live in the gateway's tool catalog for the Mission Control agent. |
| D5 | DB is source of truth for conversations | **Unchanged, made explicit**: OpenClaw owns the model runtime; SQLite owns the UX transcript. Events flow in, rows write out, reads serve iOS. |

Other deltas below are net-new gaps the old plan had, restated for the WS shape.

| # | Gap | Fix |
|---|---|---|
| C1 | `AgentEvent` union omits `session_started` and `ping`. UI relies on both. | Add to union. §5 is authoritative. |
| C2 | ~~No way for an out-of-band cancel request to reach the runner's AbortController.~~ Obsolete — cancel = `sessions.abort` RPC. | Drop `src/agent/registry.ts`. |
| C3 | Runner is driven by SSE route today; Phase 4 scheduler will drive it with no HTTP consumer. | Runner takes `onEvent` that may be a no-op. Same code path in both modes. |
| C4 | History reconstruction missing. | Add `GET /api/chat/sessions/:id/activity` returning interleaved `{ kind: 'message' \| 'tool_call', … }`. |
| C5 | `tool_result` event has no `summary`. | Keep (server-side presenters), persist to `tool_call_log.summary`. |
| C6 | ~~Multi-cycle tool-use turns need explicit reducer handling in the runner.~~ Obsolete — the gateway already emits one `text_end`/`message_end` per assistant block and sequences tool events correctly. Runner writes one `chat_messages` row per block. | Keep the test; drop the reducer complexity. |
| C7 | Token-cap error shape ambiguous. | Dedicated `error` event with `code: 'daily_cap_exceeded'`. Pre-check `getTodayTokenUsage()` against `AGENT_DAILY_TOKEN_CAP` before `agent` RPC. |
| C8 | Disconnect behavior. | Runner stays subscribed to the gateway `runId` stream regardless of HTTP client. Invocation runs to completion; client resumes via `GET /api/invocations/:id`. |
| C9 | `GET /api/invocations/:id` response unbounded. | `LIMIT 500` in `getInvocation`. Low priority. |
| C10 | Auth on SSE. | Verify `X-Intella-Token` passes through proxies when SSE ships. Own slice. |
| **N1** | **Gateway reachability becomes a hard dep.** | Reconnect with exponential backoff; `/api/chat*` returns `503 { error: 'gateway_unreachable' }` when disconnected; health probe in `/api/health`. |
| **N2** | **Tool visibility.** Our MCP tools must be exposed to the gateway agent's runtime. | Boot-time check: `tools.effective { sessionKey }` returns our 6 tools. Add an `/api/health` signal. |

## 5. Target event contract (authoritative)

The iOS-facing event contract is unchanged from what the UI doc specifies.

```ts
// src/agent/events.ts — new

export type AgentEvent =
  | { type: 'session_started'; sessionId: string; invocationId: string; runId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError: boolean; durationMs: number; summary?: string }
  | { type: 'message_complete'; messageId: string }
  | { type: 'done'; tokensIn: number; tokensOut: number }
  | { type: 'error'; error: string; code?: 'daily_cap_exceeded' | 'timeout' | 'cancelled' | 'agent' | 'transport' | 'gateway_unreachable'; fatal?: boolean }
  | { type: 'ping'; ts: string };
```

Ordering (enforced by the runner, relied on by iOS):

```
session_started
  (text_delta* | (tool_use → tool_result))*
  message_complete      // once per assistant chat_messages row
done
```

`error` may appear anywhere; `fatal: true` means the stream terminates. `ping` fires every 15s independent of the sequence.

SSE framing (Fastify):

```
event: <type>
data: <json>

```

(blank line terminates each event).

The `runId` on `session_started` is OpenClaw's gateway runId. We store it on `agent_invocations` as `gateway_run_id` for correlation with gateway logs — one nullable column added in slice 3 (§8).

## 6. New modules

### 6.1 `src/agent/events.ts`
The `AgentEvent` union above + a tiny SSE serializer (`serialize(e): string`).

### 6.2 `src/agent/presenters.ts`
```ts
export interface ToolPresenter {
  argSummary(input: unknown): string;
  resultSummary(output: unknown, isError: boolean): string;
}
export const PRESENTERS: Record<string, ToolPresenter>;
export function summarize(name: string, input: unknown, output: unknown, isError: boolean): { arg: string; result: string };
```
Ship presenters for `board`, `tasks`, `schedule` at minimum; JSON fallback for the rest. These are reusable by Phase 4 briefs.

### 6.3 `src/agent/gatewayClient.ts` (new — replaces §6.3 of the old plan)

Thin WebSocket client for the OpenClaw Gateway protocol v3. Single exported class.

```ts
export interface GatewayClientOptions {
  url: string;                // wss://… or ws://localhost:18789
  deviceId: string;           // stable fingerprint
  privateKeyPem: string;      // for connect.challenge signing
  token?: string;             // shared secret fallback
  deviceToken?: string;       // preferred after first pair
  scopes?: string[];          // default: ['operator.read', 'operator.write']
}

export class GatewayClient extends EventEmitter {
  constructor(opts: GatewayClientOptions);
  connect(): Promise<void>;                               // handshake + hello-ok
  request<T>(method: string, params?: unknown): Promise<T>;
  subscribe(eventName: string, handler: (payload: unknown) => void): () => void;
  close(): Promise<void>;
  readonly isReady: boolean;
  readonly deviceToken: string | undefined;               // refreshed on hello-ok
}
```

Responsibilities:
- Connect, wait for `connect.challenge`, sign v3 payload, send `connect` req, receive `hello-ok`.
- Respect `policy.tickIntervalMs` — close with code 4000 if silent > 2×.
- Exponential reconnect (`1s → 30s`, per docs defaults). Re-subscribe after reconnect.
- Request timeout 30s (protocol default).
- Persist `deviceToken` to disk on issue/rotation.

Reference: `openclaw/src/gateway/client.ts`. Don't invent auth flow — follow the docs [Gateway Protocol](https://docs.openclaw.ai/gateway/protocol).

### 6.4 ~~`src/agent/registry.ts`~~ — removed

Cancellation uses `sessions.abort`. No in-memory controller map needed.

### 6.5 `src/agent/mcpBridge.ts`

Unchanged from old plan: extract `TOOLS` and `dispatch(name, args)` from [src/mcp/server.ts](src/mcp/server.ts) so they can be reused. The gateway reaches these via `openclaw mcp serve` configured against our server — see slice 1. Re-export from `mcp/server.ts`.

We do **not** need the Anthropic `input_schema` reshape — the gateway MCP transport already handles that.

### 6.6 `src/agent/systemPrompt.ts` — simplified

```ts
export function buildSystemPrompt(agentId: string, additions?: string): string;
```

Unchanged public signature, but the body is much smaller: the gateway already loads `SOUL.md` and agent workspace bootstrap from OpenClaw's agent workspace. We only assemble `additions` (Phase 3 context builder output) and date/ops footer. Passed to `agent` RPC as `systemPrompt` override.

### 6.7 `src/agent/runner.ts`

Single entry point; chat-agnostic (Phase 4 scheduler reuses it).

```ts
export interface RunAgentParams {
  invocationId: string;                      // pre-created agent_invocations row
  sessionId: string;                         // our chat_sessions.id, passed as gateway sessionKey
  agentId: string;
  model?: string;                            // optional override; else agent default
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  timeoutSeconds?: number;                   // else agent default
  systemPromptAdditions?: string;            // Phase 3 context hook
  initialUserMessage: string;
  onEvent: (e: AgentEvent) => void;          // may be a no-op
}

export async function run(params: RunAgentParams): Promise<{ tokensIn: number; tokensOut: number }>;
```

Flow:

1. Pre-check `getTodayTokenUsage()` vs `AGENT_DAILY_TOKEN_CAP`; if over, emit `error` with `code: 'daily_cap_exceeded'`, `failInvocation`, return.
2. `gatewayClient.subscribe('session.message', …)`, `('session.tool', …)`, `('lifecycle', …)` — scoped to our session.
3. Call `agent` RPC: `{ sessionId, agentId, message, systemPrompt, model?, thinking?, timeoutSeconds? }` → get `{ runId }`.
4. Emit `session_started { sessionId, invocationId, runId }`. Persist `runId` on invocation row.
5. Enter the event reducer:
   - `lifecycle.start` — no-op (already emitted).
   - `assistant` delta → buffer text; emit `text_delta`.
   - `assistant` block end (`text_end` / `message_end`) → `appendMessage({ role: 'assistant', content: bufferedText, invocationId })`, emit `message_complete { messageId }`, reset buffer.
   - `tool.start` → `recordToolCallStart({ id, messageId: currentAssistantMessageId ?? null, invocationId, toolName, input })`; emit `tool_use`.
   - `tool.end` → compute `summary` via presenter; `recordToolCallResult(id, { output, isError, durationMs, summary })`; emit `tool_result`.
   - `lifecycle.end` → `completeInvocation(id, { tokensIn, tokensOut })`; emit `done`; resolve.
   - `lifecycle.error` → `failInvocation`; emit `error { code: mapped, fatal: true }`; reject.
6. On connection drop mid-run: keep the invocation; attempt reconnect; re-subscribe and resume the event stream (gateway retains `runId` state). If reconnect fails within a bounded window, `failInvocation` with `code: 'transport'`.

Tool-event edge cases:
- If `tool.start` arrives before any assistant text in the current block, `messageId` is null at the service layer — we backfill on the next `message_complete`. (Gateway normally emits `assistant` deltas alongside `tool.start`, so this is rare.)
- `durationMs` is taken from the gateway's tool-end payload; fall back to `Date.now() - startedAt` if missing.

No `AbortController`, no provider SDK, no per-cycle Anthropic message list. Cancel is external (§7.2).

### 6.8 `src/agent/chatOrchestrator.ts`

Thin glue used by the SSE and buffered chat routes:

```ts
export async function handleChatTurn(params: {
  message: string;
  agentId?: string;
  context?: ChatContextInput;
  sessionId?: string;
  onEvent: (e: AgentEvent) => void;
}): Promise<void>;
```

It:
1. Resolves agent id, session (via `findOrCreateSession` or explicit `sessionId`).
2. Appends the user message.
3. `startInvocation({ trigger: 'user_chat', … })`.
4. Builds `systemPromptAdditions` (null in Phase 2).
5. Calls `runner.run(...)`.

Replay of prior messages is **not** needed — OpenClaw's gateway manages session history per `sessionKey`. Our `chat_sessions.id` is passed as that key. (This is why we recommended MC-generated nanoids: they're naturally compatible as gateway session keys, and our DB remains authoritative for UX concerns like title, context links, deletion.)

## 7. New and changed routes

### 7.1 `POST /api/chat/stream` (new)

Body: `{ message, agentId?, sessionId?, contextType?, contextId? }` (same shape as today's `POST /api/chat`).

Response: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

Implementation: Fastify `reply.raw`; write SSE frames as `AgentEvent`s arrive from `handleChatTurn`; 15s `setInterval` for `ping`; clear on close. **Do not abort the runner on client disconnect** (C8).

If the gateway client is disconnected at turn-start: emit a single `error { code: 'gateway_unreachable', fatal: true }`, close the stream, `failInvocation`.

### 7.2 `POST /api/invocations/:id/cancel` (new)

200 with `{ cancelled: true }`. 404 if not found; 409 if already complete.

Implementation: fetch invocation, look up its `sessionId`, call `gatewayClient.request('sessions.abort', { sessionKey: sessionId })`. Runner's lifecycle-error handler transitions the invocation to `cancelled`. If the gateway returns "not running" but our row says `running`, reconcile to `cancelled` with `error='stale'`.

### 7.3 `GET /api/chat/sessions/:id/activity` (new)

Query: `?limit=&before=`.

Response:
```ts
type ChatActivityEvent =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'tool_call'; call: ToolCallLog };
```

Ordering: messages by `sortOrder`; each message's `toolCallLog` rows (filtered by `messageId`) follow it, sorted by `startedAt`. One SQL query joining `chat_messages` + `tool_call_log`, or two merged in the service.

### 7.4 `POST /api/chat` (changed)

Keep as a buffered wrapper. Accumulates text deltas, captures last `message_complete` id and `done` tokens; returns `{ reply, sessionId, agentId, invocationId }`. iOS keeps shipping against it while `/stream` stabilizes.

### 7.5 `GET /api/invocations/:id` (doc only)

Formalize as reconnect/snapshot endpoint. Add `LIMIT 500` defensive cap (C9).

### 7.6 `GET /api/health` (changed)

Add a `gateway` field to the health payload: `{ connected: boolean, lastHelloAt?: string, deviceTokenPresent: boolean, tools: { visible: string[], missing: string[] } }`. Populated from the `GatewayClient` singleton + a cached `tools.effective` probe. Lets iOS and ops see at a glance whether the backbone is up.

## 8. Schema / migrations

**One column add:**

```ts
// in agent_invocations
gatewayRunId: text('gateway_run_id'),  // OpenClaw `runId` returned by `agent` RPC
```

Rationale: correlates our rows with gateway logs/traces. Written by the runner immediately after `agent` RPC returns. Not used by iOS; nice-to-have for debugging.

Migration: `npm run generate` + `npm run migrate`; update [src/db/SCHEMAS.md](src/db/SCHEMAS.md) per [CLAUDE.md](CLAUDE.md) mapping.

`tool_call_log.summary` already exists — no migration needed for that column; we just start populating it (§6.7).

## 9. PR-sized execution slices

Each slice lands independently. Do not bundle.

1. **Tool visibility smoke test + config.** ✅ **Passed 2026-04-23.** MCP server is registered globally under `cfg.mcp.servers["mission-control"]` and resolves per-run via `loadEmbeddedPiMcpConfig`. Smoke script: [scripts/mcp-tools-smoke.ts](scripts/mcp-tools-smoke.ts) — asserts (a) `openclaw mcp show mission-control` registry entry, (b) `mcporter list intella --schema --json` exposes all 14 MC tools, (c) `openclaw agent --agent intella --json` with a forced-tool prompt returns `result.meta.toolSummary.tools` containing `mission-control__board`. Note: the original plan proposed probing `tools.effective`, but that RPC only reports `core`/`plugin`/`channel` tools in openclaw 2026.4 — MCP tools are materialized per-run and only observable via an actual agent turn. **Tool IDs inside the runtime are namespaced as `mission-control__<name>`** (double underscore) — use this prefix anywhere `tools.allow`/`deny` config references an MC tool.
2. **Gateway WS client.** ✅ **Passed 2026-04-23.** Shipped [src/agent/gatewayClient.ts](src/agent/gatewayClient.ts) (token auth, v3 handshake, tick-watchdog reconnect, request timeout, subscribe/unsubscribe, deviceToken persistence). Singleton initialized in [src/index.ts](src/index.ts); `/health` payload now includes `gateway: { connected, lastHelloAt, deviceTokenPresent }`. Smoke: `npx tsx scripts/gateway-client-smoke.ts` — 7 assertions covering handshake in <10ms, RPC req/res frame round-trip (via a structured `INVALID_REQUEST` response), `tick` event delivery to subscribers, forced-disconnect → auto-reconnect, unsubscribe, request timeout (via paused socket), and request-after-close rejection. **Caveat:** shared-token auth yields an empty scope set from the server (`hello-ok.auth.scopes = []`), so scoped RPCs like `agents.list` reject with `missing scope: operator.read`. This is expected — §11.1's pairing decision still stands; slice 4 will pair the API as a device so the `agent` RPC unlocks. Transport layer is fully validated.
3. **MCP bridge extraction.** Move `TOOLS` + `dispatch` out of [src/mcp/server.ts](src/mcp/server.ts) into [src/agent/mcpBridge.ts](src/agent/mcpBridge.ts). Verify `npm run mcp` still works and the gateway still sees the same tool set. No behavior change.
4. **Runner + events + presenters + `gateway_run_id` column.** Ship [src/agent/runner.ts](src/agent/runner.ts), [events.ts](src/agent/events.ts), [presenters.ts](src/agent/presenters.ts), [systemPrompt.ts](src/agent/systemPrompt.ts), [chatOrchestrator.ts](src/agent/chatOrchestrator.ts). Add `gateway_run_id` column. Populate `tool_call_log.summary` via presenters. Fixture-test the event mapper with canned gateway events (multi-cycle tool-use; error; cancel). No route change yet.
5. **Buffered `POST /api/chat` rewritten on the orchestrator.** Delete [src/services/chat.service.ts](src/services/chat.service.ts). Same request/response shape; tool calls are now captured in `tool_call_log` for live chat. iOS sees no change.
6. **`POST /api/chat/stream` + 15s heartbeat.** SSE route, hand-written `reply.raw` framing. Verify with `curl -N`.
7. **`POST /api/invocations/:id/cancel`.** Wire to `sessions.abort`; reconcile stale states.
8. **`GET /api/chat/sessions/:id/activity`.** History reconstruction — the key unblocker for UI slice 8.
9. **Auth middleware (`X-Intella-Token`).** Implement [src/middleware/auth.ts](src/middleware/auth.ts); verify SSE responses still flow with the custom header.

Slices 1–6 unblock the UI POC (CONTROL_LAYER_PHASE_2_UI.md §9 steps 1–5). Slices 7–8 unblock the "full" UI tier (steps 7–8). Slice 9 is cross-cutting.

## 10. Acceptance criteria (API-only)

### After slice 1 ✅
- [x] `openclaw mcp show mission-control` succeeds (registry entry present).
- [x] `mcporter list intella --schema --json` exposes all 14 MC tools (`board`, `goals`, `initiatives`, `tasks`, `requirements`, `agent_assignments`, `schedule`, `profile`, `context_groups`, `briefings`, `agents`, `chat`, `invocations`, `health`).
- [x] `openclaw agent --agent intella --json` with a forced-tool prompt lists `mission-control__board` in `result.meta.toolSummary.tools`.
- [x] Smoke script: `npx tsx scripts/mcp-tools-smoke.ts` from repo root exits 0.

### After slice 2 ✅
- [x] `GatewayClient.connect()` completes `hello-ok` in <2s against a local gateway. (Observed 7–8ms.)
- [x] Forced disconnect triggers reconnect within 5s and re-subscribes all event handlers.
- [x] `/health.gateway.connected` reflects transport state within the next tick.
- [x] Smoke: `npx tsx scripts/gateway-client-smoke.ts` exits 0.

### After slice 4
- [ ] Event-mapper unit test: a fixture gateway event stream with 2 tool-use cycles produces our events in order `session_started → text_delta → tool_use → tool_result → message_complete → text_delta → tool_use → tool_result → message_complete → done`.
- [ ] `chat_messages` has one row per assistant block, each with monotonic `sortOrder` and correct `invocationId`.
- [ ] `tool_call_log` rows reference the right `messageId` (the assistant message emitting the tool call), and carry populated `summary` from the presenter (JSON-truncation fallback for unknown tools).
- [ ] `agent_invocations.gateway_run_id` is populated for every turn.
- [ ] `AGENT_DAILY_TOKEN_CAP` blocks → `error` event with `code: 'daily_cap_exceeded'`, `fatal: true`, invocation `status='error'`.

### After slice 6
- [ ] `curl -N -X POST /api/chat/stream` streams `session_started → text_delta* → done` for a no-tool prompt.
- [ ] `ping` fires every 15s (verify by holding open for 35s).
- [ ] Client disconnecting mid-stream does not kill the invocation — it runs to `status='complete'`.
- [ ] Gateway disconnected at request time → single `error` event with `code: 'gateway_unreachable'`.

### After slice 7
- [ ] Mid-turn `POST /api/invocations/:id/cancel` aborts within 2s; invocation ends `status='cancelled'`; stream emits `error` with `code: 'cancelled'`, `fatal: true`.
- [ ] Cancelling an already-complete invocation returns 409.

### After slice 8
- [ ] `GET /api/chat/sessions/:id/activity` for a 2-cycle turn returns `[message(user), message(assistant #1), tool_call(board), message(assistant #2), tool_call(tasks)]` in that order.
- [ ] Response size on a 100-message session is bounded by the `limit` param.

### Cross-cutting
- [ ] `npm run mcp` (stdio MCP) still serves tools correctly after slice 3.
- [ ] `POST /api/chat` (buffered) still honors the legacy response shape after slice 5 — iOS can switch at its own pace.
- [ ] Docs updated per [CLAUDE.md](CLAUDE.md) mapping: [ROUTES.md](src/routes/ROUTES.md), [SERVICES.md](src/services/SERVICES.md), [SCHEMAS.md](src/db/SCHEMAS.md), [TYPES.md](src/types/TYPES.md), [README.md](README.md).
- [ ] A quick multi-provider sanity run: configure two agents with different providers (e.g. `codex` via Anthropic, `ops` via another), run a chat against each, confirm both stream through the same runner unchanged.

## 11. Open decisions

1. **Device pairing flow.** Mission Control-API as a paired operator device vs. reusing the gateway shared secret + device-token auto-promotion on first connect. Recommend the second for local dev (zero-config), migrate to explicit pairing for prod. Scoped decision for slice 2.
2. **Thinking level default.** `medium` vs leaving unset (agent default). Recommend unset — let the per-agent config in OpenClaw drive it; pass through only when iOS asks.
3. **Reasoning stream forwarding.** Gateway emits reasoning deltas as a separate stream. Not required for Phase 2 UI. Defer; revisit if the UI wants "thinking" indicators.
4. **Rate limiting / concurrency cap on `/api/chat/stream`.** Gateway already serializes per session; global "max 2 concurrent turns" is easy to add at the route layer. Defer.
5. **What happens when `tool.end` carries an error payload with no tool_use start.** Treat as an orphan: log and emit `error { code: 'agent' }` without a paired `tool_use`. Should not happen in practice.

## 12. Out of scope

- Anything from Phase 3 (context assembly) or Phase 4 (scheduler + briefs).
- Live-session join (a second client watching a running turn). Users get the snapshot endpoint + a fresh turn if they want to interact.
- `tool_input_delta` streaming.
- Structured view-refs in assistant output.
- Direct provider SDKs (Anthropic, OpenAI, Vercel AI). All provider traffic goes through the gateway.
