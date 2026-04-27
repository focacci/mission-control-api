# Routes

## Contents

- [Health](#health)
- [Goals](#goals)
- [Initiatives](#initiatives)
- [Tasks](#tasks)
  - [Core CRUD](#core-crud)
  - [Lifecycle Actions](#lifecycle-actions)
  - [Requirement Creation (under Task)](#requirement-creation-under-task)
- [Requirements](#requirements)
  - [Requirement Tests](#requirement-tests)
- [Agent Assignments](#agent-assignments)
- [Agent Outputs](#agent-outputs)
- [Schedule](#schedule)
- [Board](#board)
- [Agents](#agents)
- [Chat](#chat)
- [Conversations](#conversations)
- [Invocations](#invocations)
- [Profile](#profile)
- [Pinned Contexts](#pinned-contexts)
- [Context Groups](#context-groups)
- [Briefings](#briefings)
- [Error Handling](#error-handling)

---

All route modules are registered in [src/index.ts](../index.ts) as Fastify plugins. Every handler delegates business logic to the corresponding service. Validation is done via Zod schemas from [src/types/index.types.ts](../types/index.types.ts).

Base URL: `http://localhost:3737`

---

## Health

Defined inline in `src/index.ts`.

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/health` | Liveness check — queries goal count from DB | `{ status: "ok", goals: number }` |

---

## Goals

CRUD for top-level goal records. All writes derive `displayName` and `focusIcon` automatically.

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/goals` | List all goals | `?focus=sprint\|steady\|simmer\|dormant` | `Goal[]` sorted by focus then `sortOrder` |
| `GET` | `/api/goals/:id` | Get a single goal with its initiatives and goal-level agent assignments | — | `Goal & { initiatives: Initiative[], agentAssignments: AgentAssignment[] }` |
| `POST` | `/api/goals` | Create a goal | `{ emoji, name, focus?, timeline?, story? }` | `201 Goal` |
| `PATCH` | `/api/goals/:id` | Update a goal | `{ emoji?, name?, focus?, timeline?, story?, sortOrder? }` | `Goal` |
| `DELETE` | `/api/goals/:id` | Hard-delete a goal (cascades to initiatives + tasks) | — | `204` |

**Notes:**
- `focus` defaults to `steady` on create.
- Passing `timeline: null` or `story: null` on PATCH explicitly clears the field.
- Delete is a hard delete executed in a synchronous transaction; all initiatives and tasks under the goal are also deleted.

---

## Initiatives

CRUD for initiatives (projects/campaigns under a goal).

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/initiatives` | List initiatives | `?goalId=<id>&status=active\|backlog\|paused\|completed` | `Initiative[]` sorted by `sortOrder` |
| `GET` | `/api/initiatives/:id` | Get initiative with parent goal, tasks, and initiative-level agent assignments | — | `Initiative & { goal: Goal \| null, tasks: Task[], agentAssignments: AgentAssignment[] }` |
| `POST` | `/api/initiatives` | Create an initiative | `{ emoji, name, goalId?, mission?, status? }` | `201 Initiative` |
| `PATCH` | `/api/initiatives/:id` | Update an initiative | `{ emoji?, name?, status?, mission?, goalId?, sortOrder? }` | `Initiative` |
| `POST` | `/api/initiatives/:id/complete` | Mark initiative complete; cancels all non-terminal tasks | — | `Initiative` |
| `DELETE` | `/api/initiatives/:id` | Hard-delete initiative (cascades to tasks) | — | `204` |

**Notes:**
- `status` defaults to `active` on create.
- `POST .../complete` sets `status = completed` and cancels any tasks still in `pending`, `in-progress`, or `blocked`.

---

## Tasks

Tasks are purely human-driven units of work. Verification lives on requirements (which own tests); agent work lives on `agent_assignments`; artifacts live on schedule slots.

### Core CRUD

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/tasks` | List tasks | `?initiativeId=<id>&status=pending` (repeatable) | `Task[]` |
| `GET` | `/api/tasks/:id` | Get full task detail | — | `Task & { requirements: Requirement[], agentAssignments: AgentAssignment[], initiative: {id,emoji,name}\|null, goal: {id,emoji,name}\|null }` |
| `POST` | `/api/tasks` | Create a task | `{ name, objective, initiativeId?, requirements?: string[] }` | `201 Task` (full detail) |
| `PATCH` | `/api/tasks/:id` | Update task fields | `{ name?, objective?, status?, sortOrder? }` | `Task` (full detail) |
| `DELETE` | `/api/tasks/:id` | Hard-delete task (cascades requirements, requirement tests, agent assignments) | — | `204` |

### Lifecycle Actions

Tasks have a binary lifecycle: `pending` and `done`. The user owns "done" — they decide when their objective has been achieved. Rich agent-side lifecycle (start/block/etc.) lives on agent assignments.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `POST` | `/api/tasks/:id/done` | Complete task (validates all requirements checked) | `{ summary }` | `Task` |
| `POST` | `/api/tasks/:id/reopen` | Set status → `pending`, clear `completedAt` | — | `Task` |

**Done validation:** returns `400` if any requirement is unchecked, with a `details.incomplete` array listing the unchecked items.

### Requirement Creation (under Task)

Requirement creation is scoped under the task for convenience; all other requirement operations live under `/api/requirements/:reqId`.

| Method | Path | Description | Body |
|--------|------|-------------|------|
| `POST` | `/api/tasks/:id/requirements` | Add a requirement | `{ description }` |

---

## Requirements

Requirements are checklist items that gate task completion. Tests live under a requirement — check/uncheck and delete are addressed directly by `reqId` (no task scoping).

| Method | Path | Description | Body |
|--------|------|-------------|------|
| `PATCH` | `/api/requirements/:reqId` | Update description or completion state | `{ description?, completed? }` |
| `POST` | `/api/requirements/:reqId/check` | Mark requirement completed | — |
| `POST` | `/api/requirements/:reqId/uncheck` | Mark requirement incomplete | — |
| `DELETE` | `/api/requirements/:reqId` | Remove a requirement (cascades its tests) | — |

### Requirement Tests

| Method | Path | Description | Body |
|--------|------|-------------|------|
| `POST` | `/api/requirements/:reqId/tests` | Add a test | `{ description }` |
| `PATCH` | `/api/requirements/:reqId/tests/:testId` | Update description or passed state | `{ description?, passed? }` |
| `POST` | `/api/requirements/:reqId/tests/:testId/pass` | Mark test passed | — |
| `POST` | `/api/requirements/:reqId/tests/:testId/unpass` | Mark test not passed | — |
| `DELETE` | `/api/requirements/:reqId/tests/:testId` | Remove a test | — |

---

## Agent Assignments

Chunks of work delegated to an agent. They're the unit that gets scheduled into slots. Parents are polymorphic: an assignment is attached to exactly one of a goal, initiative, or task.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/goals/:goalId/agent-assignments` | List assignments attached to a goal | — | `(AgentAssignment & { slots: ScheduleSlot[] })[]` |
| `POST` | `/api/goals/:goalId/agent-assignments` | Create a goal-level assignment | `{ title, description?, agentId? }` | `201 AgentAssignment` |
| `GET` | `/api/initiatives/:initiativeId/agent-assignments` | List assignments attached to an initiative | — | `(AgentAssignment & { slots: ScheduleSlot[] })[]` |
| `POST` | `/api/initiatives/:initiativeId/agent-assignments` | Create an initiative-level assignment | `{ title, description?, agentId? }` | `201 AgentAssignment` |
| `GET` | `/api/tasks/:taskId/agent-assignments` | List assignments attached to a task | — | `(AgentAssignment & { slots: ScheduleSlot[] })[]` |
| `POST` | `/api/tasks/:taskId/agent-assignments` | Create a task-level assignment | `{ title, description?, agentId? }` | `201 AgentAssignment` |
| `GET` | `/api/agent-assignments/:id` | Get a single assignment | — | `AgentAssignment & { slots: ScheduleSlot[] }` |
| `PATCH` | `/api/agent-assignments/:id` | Update editable fields | `{ title?, description?, agentId?, sortOrder? }` | `AgentAssignment` |
| `POST` | `/api/agent-assignments/:id/start` | Start the assignment. From `pending`: auto-assigns the next available slot and transitions → `scheduled`. From `scheduled` or `blocked`: transitions → `in-progress`. Returns 409 from `pending` if no slot is available. | — | `AgentAssignment` |
| `POST` | `/api/agent-assignments/:id/complete` | Transition status → `done` (from `in-progress`) and stamp `completedAt` | — | `AgentAssignment` |
| `POST` | `/api/agent-assignments/:id/block` | Transition status → `blocked` (from `in-progress`) | `{ reason? }` | `AgentAssignment` |
| `POST` | `/api/agent-assignments/:id/reopen` | Transition status → `pending` (from `done` or `blocked`); clears `completedAt` | — | `AgentAssignment` |
| `POST` | `/api/agent-assignments/:id/unassign` | Clear all schedule slots referencing this AA back to `flex` and reset status → `pending`. Works from any state. | — | `AgentAssignment` |
| `DELETE` | `/api/agent-assignments/:id` | Hard-delete and clear any slots referencing it back to `flex` | — | `204` |

**Notes:**
- An assignment row carries exactly one of `goalId`, `initiativeId`, `taskId`. The parent kind is determined by which one is set; the other two are `null`.
- Scheduling resolves an assignment's owning goal by walking the chain: direct `goalId` → `initiativeId.goalId` → `taskId.initiativeId.goalId`.

---

## Agent Outputs

Structured record of one autonomous run of an Agent Assignment — the input, ordered intermediate steps (`thinking` / `tool_call` / `text`), and the final response. Distinct from chat history. There is no production write path yet; these endpoints support tests, manual creation, and the future slot-runner.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/agent-assignments/:id/outputs` | List outputs for an assignment, newest first | — | `AgentOutput[]` |
| `POST` | `/api/agent-assignments/:id/outputs` | Open a new running output | `{ input, agentId?, model? }` | `201 AgentOutput` |
| `GET` | `/api/agent-outputs/:id` | Get one output with its ordered steps | — | `{ output: AgentOutput, steps: AgentOutputStep[] }` |
| `POST` | `/api/agent-outputs/:id/steps` | Append one step (sortOrder auto-assigned). Discriminated by `kind`. | `{ kind: 'thinking' \| 'text', content }` or `{ kind: 'tool_call', toolName, toolInput, toolOutput?, isError?, durationMs? }` | `201 AgentOutputStep` |
| `POST` | `/api/agent-outputs/:id/complete` | Transition `running → complete`, write final response and token totals | `{ response, tokensIn?, tokensOut? }` | `AgentOutput` |
| `POST` | `/api/agent-outputs/:id/fail` | Transition `running → error` or `cancelled` with an error message | `{ error, status?: 'error' \| 'cancelled' }` | `AgentOutput` |
| `DELETE` | `/api/agent-outputs/:id` | Hard-delete (cascades to steps) | — | `204` |

**Notes:**
- Step append returns 409 if the parent output's status is not `running`.
- `tool_call` steps store `toolInput` as a JSON string; clients should `JSON.parse` if rendering.
- Outputs are immutable once `complete` / `error` / `cancelled`; only delete is supported.

---

## Schedule

Week plan generation, slot queries, and slot lifecycle management.

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/schedule/today` | Get all slots for today (enriched with agent assignment + outputs) | — | `SlotWithAssignment[]` (empty array if no plan for this week) |
| `GET` | `/api/schedule/week` | Get all slots for a week | `?weekStart=YYYY-MM-DD` (defaults to current week) | `{ weekPlan, slots: SlotWithAssignment[], allocations: WeekGoalAllocation[] }` |
| `GET` | `/api/schedule/range` | Get all slots in an inclusive date range | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both required) | `{ from, to, slots: SlotWithAssignment[] }` |
| `POST` | `/api/schedule/generate` | Generate a new week plan | `{ weekStart?: string }` (defaults to current week's Sunday) | `201 { weekPlan, slots, allocations }` |
| `POST` | `/api/schedule/sync` | (stub) Write-through to Obsidian SCHEDULE.md | — | `{ synced: false, message }` |
| `PATCH` | `/api/schedule/slots/:id` | Update a slot | `{ status?, agentAssignmentId?, note?, extraPrompt? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/slots/:id/done` | Mark slot done | `{ note? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/slots/:id/skip` | Skip slot | `{ reason? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/assign` | Assign an agent assignment to a slot | `{ agentAssignmentId, slotId }` | `ScheduleSlot` |
| `DELETE` | `/api/schedule/slots/:id/assignment` | Unassign the agent assignment from a slot | — | `ScheduleSlot` |
| `POST` | `/api/schedule/slots/:id/outputs` | Add an output artifact to a slot | `{ label, url? }` | `201 SlotOutput` |
| `DELETE` | `/api/schedule/slots/:slotId/outputs/:outputId` | Remove a slot output | — | `204` |

**Notes:**
- Enriched slots (`SlotWithAssignment`) include `agentAssignment` (with its parent `task` + `initiative` + `goal` if present) and `outputs: SlotOutput[]`.
- `GET /range` is week-plan-agnostic: it queries slots directly by `date`, so it spans plan boundaries. Returns `400` if `from > to` or either param is missing. Intended for month/year calendar views that need slot density across multiple weeks.
- `POST /generate` returns `409` if a plan already exists for that week. Slots linked to agent assignments are typed `agent_assignment`.
- `POST /assign` sets `slot.type = 'agent_assignment'`, `slot.status = 'pending'`, and `slot.agentAssignmentId` in a transaction. Tasks are not modified — scheduling flows through agent assignments now.
- `DELETE /slots/:id/assignment` returns `400` if the slot has no assigned AA. Clears `slot.agentAssignmentId`, resets `slot.type = 'flex'`, `slot.status = 'pending'`.
- Week start is always normalized to the Sunday of the given date before querying/inserting.

---

## Board

Unified board view and Obsidian refresh.

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/board` | Full board: goals → initiatives → tasks, stats, current week summary | `{ goals: GoalWithHierarchy[], stats, weekSummary \| null }` |
| `POST` | `/api/board/refresh` | (stub) Regenerate Obsidian Board.md | `{ refreshed: false, message }` |

**Board response shape:**
- `goals[].initiatives[].tasks[]` — full hierarchy
- `stats` — `{ total, pending, done }`
- `weekSummary` — `{ weekPlan, totalSlots, assignmentSlots, doneSlots, skippedSlots, pendingSlots, allocations }` or `null` if no plan for current week

---

## Agents

CRUD for OpenClaw agents that Intella owns. The `agents` DB table is the source of truth — **only agents Intella created are tracked**; other openclaw agents on the user's machine are ignored. Writes go through the table **and** the `openclaw` CLI (write-through). Use `POST /api/agents/repair` if a tracked agent has gone missing from the CLI.

A single row (id: `intella`) is seeded as the default agent (`isDefault: true`). The `isDefault` flag is owned by Intella; openclaw's own notion of default is ignored.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/agents` | List all Intella-tracked agents | — | `OpenclawAgent[]` |
| `GET` | `/api/agents/:id` | Get a single agent | — | `OpenclawAgent` |
| `POST` | `/api/agents` | Create a new isolated agent | `{ name, model, systemPrompt? }` | `201 OpenclawAgent` |
| `PATCH` | `/api/agents/:id` | Update editable fields | `{ systemPrompt?: string \| null }` | `OpenclawAgent` |
| `DELETE` | `/api/agents/:id` | Delete an agent and prune its workspace/state | — | `204` |
| `POST` | `/api/agents/repair` | Re-create any tracked openclaw agents that have gone missing from the CLI | — | `OpenclawAgent[]` |

**Notes:**
- `name` is normalized to an `id` (lowercase, alphanumeric + hyphens) used as the agent identifier and workspace folder name.
- Each new agent gets its own workspace at `~/.openclaw/agents/<id>/workspace`. When `systemPrompt` is provided it is written to `SOUL.md` in that workspace (OpenClaw's convention for agent personality/identity).
- **Only `systemPrompt` is editable.** `PATCH` rewrites `SOUL.md` in the agent's workspace and updates the DB row. Passing `systemPrompt: null` or `""` clears the prompt (removes `SOUL.md`). `name` and `model` are immutable — to change them, delete and recreate the agent.
- `GET` returns **only** the DB rows — external openclaw agents never appear here, even if created directly via the `openclaw` CLI.
- The `isDefault` flag is owned by Intella, not openclaw: the bootstrapped `intella` row is the sole `isDefault: true` agent, and all user-created agents are stored with `isDefault: false` regardless of what openclaw reports.
- `POST /api/agents/repair` does **not** import external openclaw agents — it only re-creates openclaw agents for rows Intella already tracks.
- Deleting the default agent (`isDefault: true`) returns a `400`. Deleting an unknown id returns `404`.

---

## Chat

Two entry points for user-initiated chat turns: a buffered JSON endpoint and an SSE streaming sibling. Both drive the same in-process Phase 2 agent runner (`chatOrchestrator.handleChatTurn`), which calls the OpenClaw Gateway `agent` RPC and persists the user + assistant messages and tool-call log.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `POST` | `/api/chat` | Send a message to an agent (buffered) | `{ message, agentId?, context?, sessionId? }` | `{ reply, sessionId, agentId, invocationId }` |
| `POST` | `/api/chat/stream` | Send a message and stream events as SSE | `{ message, agentId?, context?, sessionId? }` | `text/event-stream` of `AgentEvent` frames |

**Notes:**
- `message` must be non-empty. `agentId` defaults to `intella`.
- `context` is an optional view header (`{ type, id?, name?, emoji?, section?, date? }`) that is serialized into the user message so the agent knows what the user is looking at.
- `sessionId` (if provided and it exists) reuses the session; otherwise the orchestrator resolves one by `(agentId, context.type, context.id)` or creates a new one.
- For `/api/chat`: `reply` is the concatenation of every assistant `chat_messages` row written during the turn (joined with blank lines), so multi-cycle tool-use turns come back as a single text blob. Rich per-cycle structure is available via `GET /api/invocations/:id`.
- Fatal runner errors on the buffered endpoint surface as HTTP failures: `503` for `gateway_unreachable` / `transport`, `429` for `daily_cap_exceeded`, `504` for `timeout`, `499` for `cancelled`, `500` otherwise. The error `details` payload includes the runner `code` and the `invocationId` so callers can correlate.

### `POST /api/chat/stream` — SSE contract

Response headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Body is a sequence of SSE frames produced by `serialize()` in [src/agent/events.ts](../agent/events.ts). The first frame is always `session_started`; the last is `done` (success) or `error` with `fatal: true` (failure). A `ping` frame is emitted every 15 seconds to keep proxies / mobile NATs from killing the connection during long tool calls — clients should discard them.

| Event | Payload (data, JSON) |
|---|---|
| `session_started` | `{ type, sessionId, invocationId, runId }` |
| `text_delta` | `{ type, text }` |
| `tool_use` | `{ type, id, name, input }` |
| `tool_result` | `{ type, id, output, isError, durationMs, summary? }` |
| `message_complete` | `{ type, messageId }` |
| `done` | `{ type, tokensIn, tokensOut }` |
| `error` | `{ type, error, code?, fatal? }` |
| `ping` | `{ type, ts }` |

**Error modes:**
- Pre-stream validation errors (Zod / JSON parse) flow through the global error handler and return `400 application/json`.
- Errors *after* headers ship are SSE `error` frames with `fatal: true` followed by stream close. HTTP status is always `200` for opened streams — once headers are sent, we cannot revise the status.
- Backpressure ceiling (4 MiB buffered) destroys the socket; the runner continues detached.

**Detached runner:** A client disconnect does NOT cancel the in-flight invocation — the runner keeps writing to a no-op sink and finalizes the invocation row normally. Cancellation is a separate endpoint (slice 7); resume / replay is via the activity endpoint (slice 8).

---

## Conversations

Read and manage persisted chat sessions and their transcripts. All reads are served directly from SQLite.

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/chat/sessions` | List sessions | `?agentId=&contextType=&contextId=&limit=` | `ChatSession[]` (most recent first, default 50) |
| `POST` | `/api/chat/sessions` | Explicitly create a fresh session (bypasses the find-or-create dedup used by `/api/chat`) | `{ agentId, contextType?, contextId?, title? }` | `201 ChatSession` |
| `GET` | `/api/chat/sessions/:id` | Get session metadata + message count | — | `ChatSession & { messageCount: number }` |
| `GET` | `/api/chat/sessions/:id/messages` | Paginated transcript | `?limit=&before=<messageId>` | `ChatMessage[]` (sortOrder ascending) |
| `DELETE` | `/api/chat/sessions/:id` | Hard delete session (cascades messages + tool calls) | — | `204` |

**Notes:**
- `POST /api/chat/sessions` is the "new chat" entry point. `/api/chat` without a `sessionId` resumes the most recent matching `(agentId, contextType, contextId)` session — use this explicit create when you want a brand-new thread in the same context.
- `before=<messageId>` returns messages with a `sortOrder` lower than the anchor — use it for reverse-chronological scroll.
- `limit` is clamped to 200 for sessions and 500 for messages.
- `DELETE` removes all `chat_messages` and their `tool_call_log` rows in a single transaction.

---

## Invocations

Read-only introspection over `agent_invocations`. Used by the debugging UI and, in later phases, by the brief generator to summarize activity.

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/invocations` | List invocations | `?trigger=&status=&limit=&since=<ISO>` | `AgentInvocation[]` (most recent first, default 50) |
| `GET` | `/api/invocations/:id` | Full detail: invocation + messages + tool calls | — | `{ invocation, messages: ChatMessage[], toolCalls: ToolCallLog[] }` |
| `POST` | `/api/invocations/:id/cancel` | Abort a running gateway session for this invocation | — | `{ cancelled: true, reconciled: boolean }` |

**Notes:**
- `trigger` is one of `slot_start \| brief \| user_chat \| manual`.
- `status` is one of `running \| complete \| error \| timeout \| cancelled`.
- `since` is an ISO timestamp filter on `started_at`.
- `toolCalls` is populated starting in Phase 2; Phase 1 invocations will return an empty array.
- `POST .../cancel` calls `sessions.abort` on the OpenClaw gateway with `sessionKey = "agent:<agentId>:mc-<sessionId>"`. The runner's `lifecycle.error` handler is what writes the final `status='cancelled'` — this route only dispatches the abort. Returns `404` if the invocation is missing, `409` if it's not `running`. If the gateway reports the session isn't running but our row still says `running`, the service reconciles the row to `status='cancelled'` with `error='stale'` and returns `reconciled: true`.

---

## Profile

Long-running structured picture of the user. Seeded with six fixed sections (`overview`, `traits`, `habits`, `places`, `activities`, `purpose`) at install; entries under a section are fully CRUD.

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/profile` | Full profile (all sections with their entries) | — | `{ sections: (ProfileSection & { entries: ProfileEntry[] })[] }` |
| `GET` | `/api/profile/sections/:sectionId` | Single section with entries | — | `ProfileSection & { entries: ProfileEntry[] }` |
| `PATCH` | `/api/profile/sections/:sectionId` | Update section summary | `{ summary?: string \| null, sortOrder? }` | `ProfileSection` |
| `POST` | `/api/profile/sections/:sectionId/entries` | Add an entry to a section | `{ label, detail?, confidence?, source?, sortOrder? }` | `201 ProfileEntry` |
| `PATCH` | `/api/profile/entries/:entryId` | Update an entry | `{ label?, detail?, confidence?, source?, sortOrder? }` | `ProfileEntry` |
| `DELETE` | `/api/profile/entries/:entryId` | Remove an entry | — | `204` |

**Notes:**
- `confidence` is one of `observed \| inferred \| stated`, default `observed` on create.
- Passing `summary: null`, `detail: null`, or `source: null` on PATCH explicitly clears the field.
- `GET /api/profile` is the preferred read — the Profile view always renders every section together, so one round trip beats six.
- Sections are not user-creatable; the fixed six are seeded by `npm run seed`.

---

## Pinned Contexts

Flat list of chat-context refs pinned by the user (iOS `ChatContextStore` pinned set). Each row snapshots `(label, icon, typeName)` so the UI renders without resolving the ref.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/pinned-contexts` | List pinned contexts | — | `PinnedContext[]` |
| `POST` | `/api/pinned-contexts` | Pin a new context | `{ contextType, contextId?, label, icon, typeName, payload?, sortOrder? }` | `201 PinnedContext` |
| `DELETE` | `/api/pinned-contexts/:id` | Unpin | — | `204` |

**Notes:**
- `payload` is a free-form JSON string (e.g. `{"date":"2026-04-23","mode":"week"}` for a schedule context) that captures fields not encoded in `(contextType, contextId)`.
- No DB-level uniqueness on `(contextType, contextId, payload)`; deduplication is the client's responsibility.

---

## Context Groups

Named bundles of chat-context refs. Opening a group in the floating chat loads every member as an active context.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/context-groups` | List groups with members | — | `(ContextGroup & { members: ContextGroupMember[] })[]` |
| `GET` | `/api/context-groups/:id` | Get one group with members | — | `ContextGroup & { members: ContextGroupMember[] }` |
| `POST` | `/api/context-groups` | Create a group (optionally with initial members) | `{ name, icon?, summary?, members?: NewContextRef[] }` | `201 ContextGroup & { members }` |
| `PATCH` | `/api/context-groups/:id` | Update editable fields | `{ name?, icon?, summary?, sortOrder? }` | `ContextGroup` |
| `DELETE` | `/api/context-groups/:id` | Delete group (cascades members) | — | `204` |
| `POST` | `/api/context-groups/:id/members` | Add a member to a group | `{ contextType, contextId?, label, icon, typeName, payload?, sortOrder? }` | `201 ContextGroupMember` |
| `DELETE` | `/api/context-groups/:groupId/members/:memberId` | Remove a member | — | `204` |

**Notes:**
- Member shape mirrors `PinnedContext` (snapshot `label`/`icon`/`typeName` + optional `payload`).
- Members use POST/DELETE rather than PATCH — a member is either present or not; reordering would be added later as a `sortOrder` PATCH when the UI needs it.
- `icon` defaults to `point.3.connected.trianglepath.dotted` on create.

---

## Briefings

Morning / afternoon / evening briefings per day. At most one brief per `(date, kind)` — enforced by a unique index.

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/briefs` | List briefs within a date range | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both required) | `Brief[]` ordered by `date desc` then `kind` (morning → afternoon → evening) |
| `GET` | `/api/briefs/by-date/:date` | Get all three briefs for a single date | — | `{ date, morning: Brief \| null, afternoon: Brief \| null, evening: Brief \| null }` |
| `GET` | `/api/briefs/:id` | Get a single brief | — | `Brief` |
| `POST` | `/api/briefs/generate` | Kick agent brief generation | `{ date, kind }` | `501` until Track C (agent runner) ships |
| `PATCH` | `/api/briefs/:id` | Edit a brief (manual authoring) | `{ title?, body?, status?, references? }` | `Brief` |
| `DELETE` | `/api/briefs/:id` | Delete a brief | — | `204` |

**Notes:**
- `kind` is one of `morning \| afternoon \| evening`; `status` is one of `pending \| generating \| ready \| error`.
- `references` is a JSON-encoded string: `{tasks: string[], slots: string[], initiatives: string[]}`.
- `POST /generate` currently returns `501` with a clear message. Once Track C lands it will enqueue an agent run and return `202 { briefId, invocationId }` — consumers already holding the id can poll `GET /api/briefs/:id`.
- `PATCH` accepts `title: null` / `body: null` / `references: null` to explicitly clear those fields.

---

## Error Handling

Errors are handled globally in `src/index.ts`:

| Error type | HTTP status | Shape |
|-----------|------------|-------|
| `AppError` | `statusCode` from the error | `{ error: string, details?: unknown }` |
| `ZodError` | `400` | `{ error: "Validation failed", details: <flatten()> }` |
| Unhandled | `500` | `{ error: "Internal server error" }` |
