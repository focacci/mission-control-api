# Mission Control — Control-Layer Implementation Plan

> Evolves the API from a thin `openclaw agent` proxy into a full control layer
> that owns agent invocations, context injection, conversation persistence, and
> tool-call capture.
>
> Target implementer: a coding agent with access to this repo. Every phase is
> scoped so it can be built and verified independently.

## Contents

- [1. Goals](#1-goals)
- [2. Strategic Decisions](#2-strategic-decisions)
- [3. Provider Strategy](#3-provider-strategy)
- [4. Phase 1 — Persistence Foundation](#4-phase-1--persistence-foundation)
- [5. Phase 2 — In-Process Agent Loop](#5-phase-2--in-process-agent-loop)
- [6. Phase 3 — Context Assembly](#6-phase-3--context-assembly)
- [7. Phase 4 — Scheduler & Briefs](#7-phase-4--scheduler--briefs)
- [8. Cross-Cutting Concerns](#8-cross-cutting-concerns)
- [9. File-by-File Change Map](#9-file-by-file-change-map)
- [10. Acceptance Criteria](#10-acceptance-criteria)
- [11. Out of Scope](#11-out-of-scope)

---

## 1. Goals

Build the API as a control layer between user and LLM that:

1. **Triggers** agents on scheduled events: slot-start (at each scheduled time
   slot) and brief-generation (morning/afternoon/evening).
2. **Injects** the right context into each invocation (task details for slot
   runs, completed-work summary for briefs, view/session state for chat).
3. **Persists** every user↔agent interaction with full transcript and tool
   call history — the DB is the source of truth, not OpenClaw sessions.
4. **Captures** every tool call the LLM makes (especially Intella MCP calls)
   as structured events that drive the iOS UI in realtime and feed later brief
   generation.

Non-goals (explicitly deferred): structured view-refs in replies, retry
policies beyond a single retry, per-goal token budgets, multi-tenant auth.

---

## 2. Strategic Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Switch chat/invocation path from `execFile openclaw` to in-process **Anthropic SDK + MCP** loop. | `openclaw agent --json` only returns final text; no streaming, no tool events, no interception point. Owning the loop is a prerequisite for every other goal. |
| D2 | Keep `openclaw agents {add,delete}` CLI for agent **workspace lifecycle** (SOUL.md, workspace dirs). Drop it for messaging. | Agent identity/workspace management already works and isn't the bottleneck. |
| D3 | Talk to Claude/Grok/Copilot via the Anthropic SDK's `baseURL` override pointed at the **OpenClaw gateway**. | Preserves existing multi-provider routing without re-implementing it. Requires smoke-testing tool use per provider. |
| D4 | Mount `src/mcp/server.ts` **in-process** as the tool provider for the loop (no stdio subprocess). | Faster, simpler, already exposes every Intella operation. External MCPs attached to agents are deferred. |
| D5 | **DB is source of truth** for conversations. OpenClaw's `--session-id` is no longer used for continuity — we replay our own history into each request. | Lets us serve the iOS UI from the DB, support multiple clients, and feed briefs from structured data. |
| D6 | **SSE** for streaming (not WebSocket). | One-way server→client is the whole shape; SSE is trivial in Fastify and in `URLSession.bytes`. |
| D7 | Scheduler is an **in-process interval poller** (30s), not an external cron. | Single process, no deploy complexity. SQLite already serializes. |
| D8 | **Hybrid context injection**: inject a concise header; let the agent pull depth via MCP. | Avoids staleness when the user edits mid-run and keeps prompts small. |

---

## 3. Provider Strategy

### 3.1 Gateway configuration

Add to `.env`:

```env
ANTHROPIC_BASE_URL=<openclaw-gateway-url>
ANTHROPIC_API_KEY=<gateway-token>
AGENT_DEFAULT_MODEL=claude-opus-4-6
AGENT_MAX_TOKENS=4096
AGENT_INVOCATION_TIMEOUT_MS=120000
AGENT_DAILY_TOKEN_CAP=2000000
INTELLA_AUTH_TOKEN=<shared-secret-for-ios-client>
```

Move `OPENCLAW_GATEWAY_TOKEN` out of the hardcoded literal in
[src/services/chat.service.ts:8](src/services/chat.service.ts#L8). Delete that
file once Phase 2 lands.

### 3.2 SDK setup

Add dependency: `@anthropic-ai/sdk@^0.32`.

```ts
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL,
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

### 3.3 Tool-use smoke test (do this first)

Before building Phase 2, verify the OpenClaw gateway correctly round-trips
Anthropic-format `tool_use` / `tool_result` blocks for each provider we care
about. Quick script: send a prompt that forces the `board` MCP tool call,
assert `stop_reason === 'tool_use'` and a valid tool block. Run once per
target model. If any provider fails, document and fall back to Vercel `ai`
SDK (bigger change; keep Anthropic SDK for providers that pass).

---

## 4. Phase 1 — Persistence Foundation

**Goal:** every chat message, agent invocation, and tool call is recorded in
SQLite. No behavior change visible to iOS yet; just write-through.

### 4.1 Schema additions (`src/db/schema.ts`)

```ts
export const agentInvocations = sqliteTable('agent_invocations', {
  id: text('id').primaryKey(),                    // nanoid
  trigger: text('trigger', {
    enum: ['slot_start', 'brief', 'user_chat', 'manual'],
  }).notNull(),
  triggerRefId: text('trigger_ref_id'),           // slotId | taskId | null
  agentId: text('agent_id').notNull(),
  sessionId: text('session_id').notNull(),        // chat_sessions.id
  status: text('status', {
    enum: ['running', 'complete', 'error', 'timeout', 'cancelled'],
  }).notNull().default('running'),
  model: text('model').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  error: text('error'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
});

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  contextType: text('context_type'),              // 'task' | 'goal' | ... | null for freeform
  contextId: text('context_id'),
  title: text('title'),                           // derived on first user turn
  createdAt: text('created_at').notNull(),
  lastMessageAt: text('last_message_at').notNull(),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  invocationId: text('invocation_id'),            // null for user turns until invocation starts
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),             // final text; partial deltas not stored
  sortOrder: integer('sort_order').notNull(),     // monotonic per session
  createdAt: text('created_at').notNull(),
});

export const toolCallLog = sqliteTable('tool_call_log', {
  id: text('id').primaryKey(),                    // Anthropic's tool_use_id
  messageId: text('message_id').notNull()
    .references(() => chatMessages.id, { onDelete: 'cascade' }),
  invocationId: text('invocation_id').notNull(),
  toolName: text('tool_name').notNull(),
  input: text('input').notNull(),                 // JSON string
  output: text('output'),                         // JSON string (null until resolved)
  isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
});
```

Run `npm run generate` then `npm run migrate`.

### 4.2 Service: `src/services/conversations.service.ts` (new)

Functions:
- `createSession({ agentId, contextType?, contextId? }) → ChatSession`
- `findOrCreateSession({ agentId, contextType, contextId }) → ChatSession`
  (dedup key: `agentId + contextType + contextId`, one active session per combo)
- `appendMessage({ sessionId, invocationId?, role, content }) → ChatMessage`
  (auto-increments `sortOrder`, updates `session.lastMessageAt`)
- `listMessages(sessionId, { limit?, before? }) → ChatMessage[]`
- `listSessions({ agentId?, contextType?, contextId?, limit? }) → ChatSession[]`

### 4.3 Service: `src/services/invocations.service.ts` (new)

Functions:
- `startInvocation({ trigger, triggerRefId?, agentId, sessionId, model }) → AgentInvocation`
- `completeInvocation(id, { tokensIn, tokensOut }) → AgentInvocation`
- `failInvocation(id, { error, status: 'error' | 'timeout' | 'cancelled' }) → AgentInvocation`
- `listInvocations({ limit?, trigger?, status?, since? }) → AgentInvocation[]`
- `getInvocation(id) → { invocation, messages, toolCalls }` — for debugging UI

### 4.4 Service: `src/services/toolCalls.service.ts` (new)

- `recordToolCallStart({ id, messageId, invocationId, toolName, input }) → void`
- `recordToolCallResult(id, { output, isError, durationMs }) → void`

### 4.5 Refactor chat service

Replace [src/services/chat.service.ts](src/services/chat.service.ts) with a
thin version that still uses `openclaw` (no loop change yet) but now:

1. Resolves/creates a `chat_sessions` row.
2. Writes the user message via `appendMessage` before invoking the agent.
3. Starts an `agent_invocations` row with `trigger='user_chat'`.
4. On openclaw success, writes the assistant message and completes the invocation.
5. On failure, fails the invocation with the error.

**Note:** tool calls stay uncaptured in Phase 1 — openclaw doesn't expose them.
That's fine; Phase 2 picks them up.

### 4.6 Routes (`src/routes/`)

New file `conversations.routes.ts`:
- `GET /api/chat/sessions` — query `?agentId=&contextType=&contextId=&limit=`
- `GET /api/chat/sessions/:id` — session metadata + message count
- `GET /api/chat/sessions/:id/messages` — paginated transcript
- `DELETE /api/chat/sessions/:id` — hard delete (cascades messages + tool calls)

New file `invocations.routes.ts`:
- `GET /api/invocations` — query `?trigger=&status=&limit=&since=`
- `GET /api/invocations/:id` — full detail (messages + tool calls) for debugging

Register both in [src/index.ts](src/index.ts).

### 4.7 Types (`src/types/index.types.ts`)

Add Zod schemas for request bodies, inferred types for each new entity, and
re-export from `types/TYPES.md`.

### 4.8 Docs

Per [CLAUDE.md](CLAUDE.md), update:
- `src/db/SCHEMAS.md` — new tables
- `src/services/SERVICES.md` — new service functions
- `src/routes/ROUTES.md` — new routes
- `src/types/TYPES.md` — new Zod schemas
- `README.md` — summary changes

### 4.9 Verification

- [ ] Send a chat message from iOS — verify rows appear in `chat_sessions`,
      `chat_messages`, `agent_invocations`.
- [ ] `GET /api/chat/sessions?contextType=task&contextId=<id>` returns the
      session.
- [ ] `GET /api/invocations/:id` returns the invocation with both user and
      assistant messages.
- [ ] Deleting a session cascades to messages and tool calls.

---

## 5. Phase 2 — In-Process Agent Loop

**Goal:** replace the openclaw subprocess with an in-process Anthropic SDK
loop that uses the MCP server directly. Stream text and tool events to
clients via SSE.

### 5.1 Dependency

```json
"@anthropic-ai/sdk": "^0.32"
```

### 5.2 MCP in-process adapter (`src/agent/mcpBridge.ts` — new)

Refactor dispatch logic out of [src/mcp/server.ts](src/mcp/server.ts) into
`src/agent/mcpBridge.ts` so it can be called both by the stdio MCP server and
directly by the in-process runner without Server/client round-trips.

Exports:
- `TOOLS: Anthropic.Tool[]` — the same tool schemas, shaped for Anthropic's
  `tool_use` API (`name`, `description`, `input_schema`).
- `dispatchTool(name: string, input: unknown) → Promise<{ output: unknown, isError: boolean }>`
  — reuses the existing dispatch logic.

Update `src/mcp/server.ts` to import from the bridge; verify the stdio
`npm run mcp` still works.

### 5.3 Agent runner (`src/agent/runner.ts` — new)

Single entry point used by all invocation triggers:

```ts
interface RunAgentParams {
  agentId: string;
  sessionId: string;           // existing or newly created
  invocationId: string;        // pre-created agent_invocations row
  systemPrompt: string;        // from SOUL.md + standard ops
  priorMessages: Anthropic.MessageParam[];  // replayed from DB
  initialUserMessage: string;  // what kicks off this turn
  model: string;
  maxTokens: number;
  timeoutMs: number;
  onEvent: (e: AgentEvent) => void;   // SSE dispatcher
}

type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; output: unknown; isError: boolean; durationMs: number }
  | { type: 'message_complete'; messageId: string }
  | { type: 'done'; tokensIn: number; tokensOut: number }
  | { type: 'error'; error: string };
```

Loop body:

1. Call `client.messages.stream({ model, system, messages, tools: TOOLS, max_tokens })`.
2. As deltas arrive, emit `text_delta` events and accumulate text.
3. At `message_stop`, append an assistant `chat_messages` row with the full text.
4. If `stop_reason === 'tool_use'`:
   - For each `tool_use` block, emit `tool_use`, call
     `recordToolCallStart`, invoke `dispatchTool`, then emit `tool_result`
     and call `recordToolCallResult`.
   - Push assistant message (with tool_use) and a user message (with
     tool_result blocks) onto `messages` and continue the loop.
5. Respect `timeoutMs` with `AbortController`; on abort emit `error` and fail
   the invocation.
6. Enforce `AGENT_DAILY_TOKEN_CAP` — before starting a turn, sum
   `agent_invocations.tokensIn + tokensOut` for today; if over, abort with
   a 429-shaped error event.

Return: `{ finalText, tokensIn, tokensOut }`.

### 5.4 System prompt assembly

Helper: `buildSystemPrompt(agentId): string`
- Base: read `{workspace}/SOUL.md` (fall back to a default persona).
- Append: standard operating section with date, available tool hints, and a
  hard line that tool calls must come *before* final prose output.

### 5.5 SSE streaming route

New route file or add to `chat.routes.ts`:

- `POST /api/chat/stream`
  - Body: `{ agentId?, sessionId?, contextType?, contextId?, message }`
  - Response: `Content-Type: text/event-stream`
  - Each `AgentEvent` is emitted as `event: <type>\ndata: <json>\n\n`
  - Also emits final `event: done` with the new `messageId` so clients can
    fetch the full record.

Keep `POST /api/chat` (non-streaming) as a convenience wrapper that buffers
stream events and returns a single JSON response — iOS can migrate at its
own pace.

### 5.6 Delete old chat service

Remove [src/services/chat.service.ts](src/services/chat.service.ts) once
the SSE route replaces it. Update
[src/routes/chat.routes.ts](src/routes/chat.routes.ts) to call the runner.

### 5.7 Verification

- [ ] Send a chat message that should trigger a `board` tool call —
      verify `tool_call_log` has a row with input and output.
- [ ] SSE stream emits `text_delta` → `tool_use` → `tool_result` →
      `done` in correct order.
- [ ] A 3-turn tool-use conversation completes within `timeoutMs`.
- [ ] `AGENT_DAILY_TOKEN_CAP` blocks when exceeded.
- [ ] `npm run mcp` (stdio MCP server) still works for external clients.

---

## 6. Phase 3 — Context Assembly

**Goal:** centralize *what goes into each prompt* based on trigger type.

### 6.1 Context builder (`src/agent/context.ts` — new)

```ts
interface AssembledContext {
  systemPromptAdditions: string;  // appended to base SOUL.md
  initialUserMessage: string;     // first user turn
  priorMessages: Anthropic.MessageParam[];  // replayed from DB
  metadata: {
    trigger: string;
    refIds: { slotId?: string; taskId?: string; sessionId?: string };
  };
}

async function buildSlotStartContext(slotId: string): Promise<AssembledContext>;
async function buildBriefContext(kind: 'morning'|'afternoon'|'evening'): Promise<AssembledContext>;
async function buildChatContext(params: { sessionId: string; userMessage: string; contextType?: string; contextId?: string }): Promise<AssembledContext>;
```

### 6.2 Slot-start context

- Load slot → task → requirements → tests → initiative → goal.
- `initialUserMessage`: concise header —
  ```
  It's time to work on: <task.displayName>

  Objective: <task.objective>

  Requirements (<done>/<total> complete):
  - [ ] <req>
  - [x] <req>

  Tests:
  - [ ] <test>

  Update requirement/test status as you complete them. Call `tasks complete`
  with a summary when done, or `tasks block` with a reason if blocked.
  ```
- No prior messages (fresh session per slot-start).

### 6.3 Brief context

- Look up the most recent prior brief of this kind → `sinceIso`.
- Pull: completed tasks since then, schedule slots marked done/skipped,
  tool-call summary (counts by tool name), outstanding blocked tasks.
- `initialUserMessage`:
  ```
  Generate the <kind> brief covering <sinceIso> → <now>.

  Completed tasks: <list>
  Blocked tasks: <list>
  Skipped slots: <list>
  Agent activity: <tool-call counts>

  Output: 2-4 short paragraphs in first person, then a bulleted "What's next"
  for the remainder of the day. No headers.
  ```

### 6.4 Chat context

- Replay last N messages (configurable; default 20) from the session.
- Inject a short context line referencing the view the user is on if
  `contextType/contextId` provided. Matches today's behavior in
  [src/services/chat.service.ts:31-48](src/services/chat.service.ts#L31-L48).

### 6.5 Verification

- [ ] Unit test each builder against seed data; compare generated prompts
      against a golden snapshot.
- [ ] Slot-start prompt is < 2KB for a typical task.
- [ ] Brief prompt includes all entities changed since previous brief.

---

## 7. Phase 4 — Scheduler & Briefs

**Goal:** the API autonomously fires agents at slot times and produces
briefs; briefs are first-class entities visible in iOS.

### 7.1 Schema additions

Add to `schedule_slots`:
```ts
lastFiredAt: text('last_fired_at'),  // ISO timestamp; null = never fired
```

New table:
```ts
export const briefs = sqliteTable('briefs', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['morning', 'afternoon', 'evening'] }).notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  content: text('content').notNull(),             // final assistant text
  invocationId: text('invocation_id').notNull(),
  slotId: text('slot_id').references(() => scheduleSlots.id, { onDelete: 'set null' }),
  generatedAt: text('generated_at').notNull(),
});
```

### 7.2 Scheduler worker (`src/scheduler/worker.ts` — new)

- `startScheduler()` — called from [src/index.ts](src/index.ts) after routes register.
- `setInterval(tick, 30_000)` + one immediate tick on boot.
- `tick()`:
  1. `SELECT * FROM schedule_slots WHERE datetime <= now() AND status = 'pending' AND lastFiredAt IS NULL ORDER BY datetime`.
  2. For each slot, set `lastFiredAt = now()` in the same transaction (claim it).
  3. Dispatch based on slot `type`:
     - `task` + non-null `taskId` → `fireSlotStart(slot)`
     - `brief` → `fireBrief(slot)` with kind derived from `slot.time` (08:00 → morning, 12:00 → afternoon, 20:00 → evening; configurable map)
     - `maintenance`, `planning`, `flex` → no-op for now
- Parallelism: one slot at a time (simple; schedule density is low).

### 7.3 Slot-start firing (`src/scheduler/slotStart.ts` — new)

1. `buildSlotStartContext(slotId)`.
2. Create session (`agentId = default`, `contextType='slot'`, `contextId=slotId`).
3. Create invocation (`trigger='slot_start'`, `triggerRefId=slotId`).
4. Set task status → `in-progress`.
5. Run agent via runner; pipe events to a no-op sink (no live client).
6. On success: leave task status alone (the agent completes it via
   `tasks complete` tool call). Mark slot `status='in-progress'`.
7. On failure/timeout: fail the invocation, reset slot
   `lastFiredAt = null` so it can be retried once, incrementing a
   `retry_count` column (add to schema); after 1 retry, mark slot
   `status='skipped'` with note `"agent timeout"`.

### 7.4 Brief firing (`src/scheduler/brief.ts` — new)

1. `buildBriefContext(kind)`.
2. Create session (one-shot per brief), invocation (`trigger='brief'`,
   `triggerRefId=slotId`).
3. Run agent (tools available but most briefs won't need them).
4. On success: insert `briefs` row with assistant text, mark slot done.
5. On failure: fail invocation, leave slot pending for one retry.

### 7.5 Routes

New `src/routes/briefs.routes.ts`:
- `GET /api/briefs` — query `?kind=&limit=&since=`
- `GET /api/briefs/:id`
- `POST /api/briefs/generate` — body `{ kind, periodStart?, periodEnd? }` — manual trigger for testing

### 7.6 iOS changes (outside this repo, but listed for coordination)

- New Briefs tab/list view consuming `GET /api/briefs`.
- Invocations debug view consuming `GET /api/invocations`.
- Migrate chat to SSE endpoint (add `URLSession.bytes` consumer; update
  [ChatConversationView.swift](../mission-control-ios/MissionControl/Views/FloatingChat/ChatConversationView.swift)).

These are tracked separately; the API must ship the endpoints first.

### 7.7 Verification

- [ ] Seed a slot with `datetime = now() - 1min`, `type='task'`,
      `status='pending'`; start the API; verify within 30s an
      invocation row appears and the task moves to `in-progress`.
- [ ] Seed a brief slot similarly; verify a `briefs` row appears and
      the slot is marked done.
- [ ] A timing-out invocation retries once, then the slot is skipped.
- [ ] The scheduler does not re-fire a slot on restart (idempotency via
      `lastFiredAt`).

---

## 8. Cross-Cutting Concerns

### 8.1 Auth

Add a Fastify `preHandler` hook that requires `X-Intella-Token: <INTELLA_AUTH_TOKEN>`
on all `/api/*` routes except `GET /health`. Bypass in dev via
`INTELLA_AUTH_DISABLED=1`. iOS already has a client config point — add the
header there.

### 8.2 Observability

- Log every invocation start/end at `info` level with `invocationId`.
- Add a `/api/stats` endpoint returning today's token usage + invocation
  counts by trigger.
- Retain `agent_invocations` and `tool_call_log` for 30 days (add a daily
  cleanup in the scheduler).

### 8.3 Error handling

- Runner errors surface as failed invocations, never uncaught exceptions in
  the scheduler (the tick loop must catch).
- AppError pattern already in place via [src/types/index.types.ts](src/types/index.types.ts);
  new services use it.

### 8.4 Concurrency

- SQLite is fine for this workload; wrap multi-step mutations in
  synchronous transactions via `db.transaction` (matches current
  [src/services/schedule.service.ts](src/services/schedule.service.ts) style).
- Scheduler tick uses a transaction to claim slots (SELECT → UPDATE
  lastFiredAt) so double-tick is safe.

### 8.5 Config checklist for `.env`

```env
# Existing
PORT=3737
DB_PATH=./data/mission-control.db
VAULT_PATH=/Users/michaelfocacci/Library/Mobile Documents/iCloud~md~obsidian/Documents/Main
WORKSPACE_PATH=/Users/michaelfocacci/.openclaw/workspace

# New
ANTHROPIC_BASE_URL=<openclaw-gateway-url>
ANTHROPIC_API_KEY=<gateway-token>
AGENT_DEFAULT_MODEL=claude-opus-4-6
AGENT_MAX_TOKENS=4096
AGENT_INVOCATION_TIMEOUT_MS=120000
AGENT_DAILY_TOKEN_CAP=2000000
INTELLA_AUTH_TOKEN=<shared-secret>
# INTELLA_AUTH_DISABLED=1  # uncomment in dev
```

---

## 9. File-by-File Change Map

### New files

| Path | Phase | Purpose |
|---|---|---|
| `src/agent/mcpBridge.ts` | 2 | Extract dispatch from stdio server for in-process calls |
| `src/agent/runner.ts` | 2 | Anthropic SDK + MCP loop |
| `src/agent/context.ts` | 3 | Build prompts per trigger type |
| `src/scheduler/worker.ts` | 4 | Interval-based slot claimer |
| `src/scheduler/slotStart.ts` | 4 | Fire task slots |
| `src/scheduler/brief.ts` | 4 | Fire brief slots |
| `src/services/conversations.service.ts` | 1 | sessions + messages CRUD |
| `src/services/invocations.service.ts` | 1 | invocation lifecycle |
| `src/services/toolCalls.service.ts` | 1 | tool call log |
| `src/services/briefs.service.ts` | 4 | briefs CRUD |
| `src/routes/conversations.routes.ts` | 1 | `/api/chat/sessions/*` |
| `src/routes/invocations.routes.ts` | 1 | `/api/invocations/*` |
| `src/routes/briefs.routes.ts` | 4 | `/api/briefs/*` |
| `src/middleware/auth.ts` | 8 | Fastify preHandler for `X-Intella-Token` |

### Modified files

| Path | Phase | Change |
|---|---|---|
| `src/db/schema.ts` | 1, 4 | Add 5 tables + `lastFiredAt`, `retryCount` on slots |
| `src/types/index.types.ts` | 1, 4 | Zod schemas for new entities |
| `src/mcp/server.ts` | 2 | Import dispatch from `mcpBridge.ts` |
| `src/routes/chat.routes.ts` | 2 | Replace openclaw proxy with SSE + buffered routes |
| `src/index.ts` | 1, 4, 8 | Register new routes, start scheduler, install auth hook |
| `package.json` | 2 | Add `@anthropic-ai/sdk` |
| `.env` | 3, 8 | New config keys |
| Docs: `README.md`, `src/db/SCHEMAS.md`, `src/routes/ROUTES.md`, `src/services/SERVICES.md`, `src/types/TYPES.md` | all | Keep in sync per [CLAUDE.md](CLAUDE.md) |

### Deleted files

| Path | Phase | Reason |
|---|---|---|
| `src/services/chat.service.ts` | 2 | Replaced by runner |

---

## 10. Acceptance Criteria

### Phase 1

- [ ] All 4 new tables migrate cleanly on a fresh DB.
- [ ] Sending `POST /api/chat` (iOS-compatible shape) writes user + assistant
      messages, an invocation, and returns the same response shape as before.
- [ ] `GET /api/chat/sessions?contextType=task&contextId=X` returns the
      session after a task-scoped chat.
- [ ] `GET /api/invocations/:id` returns transcript + (empty) tool call array.

### Phase 2

- [ ] Provider smoke test passes for Claude; documented result for Grok
      and Copilot (pass or documented limitation).
- [ ] `POST /api/chat/stream` emits SSE events in order:
      `text_delta* → (tool_use → tool_result)* → text_delta* → done`.
- [ ] `tool_call_log` rows appear for every MCP call made during a chat.
- [ ] `npm run mcp` still serves external MCP clients.
- [ ] `POST /api/chat` (non-streaming) still works as a buffered wrapper.
- [ ] Token cap enforced: simulated over-budget request returns 429-shape
      error event.

### Phase 3

- [ ] Golden snapshot tests for each context builder.
- [ ] Chat with `contextType=task`, `contextId=X` includes the task header
      in the first user turn.

### Phase 4

- [ ] Scheduler fires an overdue slot within 60s of API start.
- [ ] `lastFiredAt` idempotency: restart the API mid-tick, slot does not
      double-fire.
- [ ] A brief slot produces a `briefs` row visible via
      `GET /api/briefs?kind=morning`.
- [ ] Timeout path: an invocation exceeding `AGENT_INVOCATION_TIMEOUT_MS`
      fails cleanly, slot retries once, then skips with a note.

### Cross-cutting

- [ ] `X-Intella-Token` required on `/api/*`; missing/wrong returns 401.
- [ ] `GET /health` unauthenticated.
- [ ] All doc files updated per [CLAUDE.md](CLAUDE.md) mapping.

---

## 11. Out of Scope

Explicitly deferred — do NOT build in this pass:

- **Structured view-refs** in chat replies (cards that deep-link). Parse
  still happens at the iOS layer or in a later pass.
- **Event-based brief triggers** (e.g., "3 tasks done in a row"). Time-based
  only for now.
- **Multi-agent concurrency**. One agent per invocation; if two slots fire
  the same second, they serialize.
- **Structured output / JSON-mode for briefs**. Freeform text only.
- **External MCP servers** (anything beyond Intella's own). Agent's other
  MCP tools are ignored by the in-process runner for now.
- **Per-user / multi-tenant**. Single-user, single shared token.
- **Retry policies beyond 1 retry**. No exponential backoff, no dead letter.
- **Live-session join** when user opens chat while agent is mid-run. User
  messages start a new turn after current completes.
- **Vercel `ai` SDK migration**. Only if Phase 2's smoke test reveals that
  tool use doesn't round-trip through the OpenClaw gateway.

---

## Execution order recap

1. Phase 1 (persistence) — fully deployable; no iOS changes required.
2. Provider smoke test (Section 3.3).
3. Phase 2 (in-process loop) — deployable; iOS can keep using `POST /api/chat` until migrated.
4. Phase 3 (context builders) — deployable; used by Phase 4.
5. Phase 4 (scheduler + briefs) — requires Phase 2 + 3.
6. Cross-cutting (auth, stats, cleanup) — can land anytime after Phase 1.

Each phase has its own acceptance checklist. Land one at a time; do not
bundle.
