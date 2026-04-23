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
- [Schedule](#schedule)
- [Board](#board)
- [Agents](#agents)
- [Chat](#chat)
- [Conversations](#conversations)
- [Invocations](#invocations)
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
| `GET` | `/api/goals/:id` | Get a single goal with its initiatives | — | `Goal & { initiatives: Initiative[] }` |
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
| `GET` | `/api/initiatives/:id` | Get initiative with parent goal and tasks | — | `Initiative & { goal: Goal \| null, tasks: Task[] }` |
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

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `POST` | `/api/tasks/:id/start` | Transition status → `in-progress` | — | `Task` |
| `POST` | `/api/tasks/:id/done` | Complete task (validates all requirements checked) | `{ summary }` | `Task` |
| `POST` | `/api/tasks/:id/block` | Block task with a reason | `{ reason }` | `Task` |
| `POST` | `/api/tasks/:id/cancel` | Cancel task | — | `Task` |

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

Chunks of task work delegated to an agent. They're the unit that gets scheduled into slots (not tasks themselves).

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/tasks/:taskId/agent-assignments` | List assignments for a task (each with the slots currently referencing it) | — | `(AgentAssignment & { slots: ScheduleSlot[] })[]` |
| `POST` | `/api/tasks/:taskId/agent-assignments` | Create an assignment | `{ name, agentId?, instructions? }` | `201 AgentAssignment` |
| `GET` | `/api/agent-assignments/:id` | Get a single assignment | — | `AgentAssignment & { slots: ScheduleSlot[] }` |
| `PATCH` | `/api/agent-assignments/:id` | Update editable fields | `{ name?, agentId?, instructions?, sortOrder? }` | `AgentAssignment` |
| `POST` | `/api/agent-assignments/:id/complete` | Set `completed: true` and stamp `completedAt` | — | `AgentAssignment` |
| `DELETE` | `/api/agent-assignments/:id` | Hard-delete and clear any slots referencing it back to `flex` | — | `204` |

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
| `PATCH` | `/api/schedule/slots/:id` | Update a slot | `{ status?, agentAssignmentId?, note? }` | `ScheduleSlot` |
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
- `stats` — `{ total, pending, inProgress, done, blocked, cancelled }`
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

Single entry point for user-initiated chat turns. The handler persists the user message, starts an `agent_invocations` row, proxies the prompt through `openclaw`, and writes the assistant reply. Phase 2 will add an SSE streaming sibling route.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `POST` | `/api/chat` | Send a message to an agent | `{ message, agentId?, context?, sessionId? }` | `{ reply, sessionId, agentId, invocationId }` |

**Notes:**
- `message` must be non-empty. `agentId` defaults to `intella`.
- `context` is an optional view header (`{ type, id?, name?, emoji?, section?, date? }`) that is serialized into the prompt so the agent knows what the user is looking at.
- `sessionId` (if provided and it exists) reuses the session; otherwise the service resolves one by `(agentId, context.type, context.id)` or creates a new one.
- The `invocationId` in the response is the `agent_invocations.id` for the turn — use it with `GET /api/invocations/:id` to pull the full transcript + (Phase 2) tool-call trace.

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

**Notes:**
- `trigger` is one of `slot_start \| brief \| user_chat \| manual`.
- `status` is one of `running \| complete \| error \| timeout \| cancelled`.
- `since` is an ISO timestamp filter on `started_at`.
- `toolCalls` is populated starting in Phase 2; Phase 1 invocations will return an empty array.

---

## Error Handling

Errors are handled globally in `src/index.ts`:

| Error type | HTTP status | Shape |
|-----------|------------|-------|
| `AppError` | `statusCode` from the error | `{ error: string, details?: unknown }` |
| `ZodError` | `400` | `{ error: "Validation failed", details: <flatten()> }` |
| Unhandled | `500` | `{ error: "Internal server error" }` |
