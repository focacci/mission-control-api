# Routes

## Contents

- [Health](#health)
- [Goals](#goals)
- [Initiatives](#initiatives)
- [Tasks](#tasks)
  - [Core CRUD](#core-crud)
  - [Lifecycle Actions](#lifecycle-actions)
  - [Requirements Sub-Routes](#requirements-sub-routes)
  - [Tests Sub-Routes](#tests-sub-routes)
  - [Outputs Sub-Routes](#outputs-sub-routes)
- [Schedule](#schedule)
- [Board](#board)
- [Agents](#agents)
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
- `POST .../complete` sets `status = completed` and cancels any tasks still in `pending`, `assigned`, `in-progress`, or `blocked`.

---

## Tasks

Full CRUD plus lifecycle actions and three sub-resource collections (requirements, tests, outputs).

### Core CRUD

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/tasks` | List tasks with requirements & tests | `?initiativeId=<id>&status=pending` (repeatable: `?status=pending&status=assigned`) | `Task[]` each with `requirements` and `tests` arrays |
| `GET` | `/api/tasks/:id` | Get full task detail | — | `Task & { requirements, tests, outputs, initiative, slot: null }` |
| `POST` | `/api/tasks` | Create a task | `{ name, objective, initiativeId?, emoji?, requirements?: string[], tests?: string[] }` | `201 Task` (full detail) |
| `PATCH` | `/api/tasks/:id` | Update task fields | `{ name?, objective?, status?, sortOrder? }` | `Task` (full detail) |
| `DELETE` | `/api/tasks/:id` | Hard-delete task | — | `204` |

### Lifecycle Actions

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `POST` | `/api/tasks/:id/start` | Transition status → `in-progress` | — | `Task` |
| `POST` | `/api/tasks/:id/done` | Complete task (validates all requirements checked) | `{ summary, outputs?: [{ label, url? }] }` | `Task` |
| `POST` | `/api/tasks/:id/block` | Block task with a reason | `{ reason }` | `Task` |
| `POST` | `/api/tasks/:id/cancel` | Cancel task | — | `Task` |

**Done validation:** returns `400` if any requirement is unchecked, with a `details.incomplete` array listing the unchecked items.

### Requirements Sub-Routes

| Method | Path | Description | Body |
|--------|------|-------------|------|
| `POST` | `/api/tasks/:id/requirements` | Add a requirement | `{ description }` |
| `PATCH` | `/api/tasks/:taskId/requirements/:reqId` | Update description or completion state | `{ description?, completed? }` |
| `POST` | `/api/tasks/:taskId/requirements/:reqId/check` | Mark requirement completed | — |
| `POST` | `/api/tasks/:taskId/requirements/:reqId/uncheck` | Mark requirement incomplete | — |
| `DELETE` | `/api/tasks/:taskId/requirements/:reqId` | Remove a requirement | — |

### Tests Sub-Routes

| Method | Path | Description | Body |
|--------|------|-------------|------|
| `POST` | `/api/tasks/:id/tests` | Add a test | `{ description }` |
| `PATCH` | `/api/tasks/:taskId/tests/:testId` | Update description or passed state | `{ description?, passed? }` |
| `DELETE` | `/api/tasks/:taskId/tests/:testId` | Remove a test | — |

### Outputs Sub-Routes

| Method | Path | Description | Body |
|--------|------|-------------|------|
| `POST` | `/api/tasks/:id/outputs` | Add an output artifact | `{ label, url? }` |
| `DELETE` | `/api/tasks/:taskId/outputs/:outputId` | Remove an output | — |

---

## Schedule

Week plan generation, slot queries, and slot lifecycle management.

| Method | Path | Description | Body / Query | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/schedule/today` | Get all slots for today (with task detail) | — | `SlotWithTask[]` (empty array if no plan for this week) |
| `GET` | `/api/schedule/week` | Get all slots for a week | `?weekStart=YYYY-MM-DD` (defaults to current week) | `{ weekPlan, slots: SlotWithTask[], allocations: WeekGoalAllocation[] }` |
| `POST` | `/api/schedule/generate` | Generate a new week plan | `{ weekStart?: string }` (defaults to current week's Sunday) | `201 { weekPlan, slots, allocations }` |
| `POST` | `/api/schedule/sync` | (stub) Write-through to Obsidian SCHEDULE.md | — | `{ synced: false, message }` |
| `PATCH` | `/api/schedule/slots/:id` | Update a slot | `{ status?, taskId?, note? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/slots/:id/done` | Mark slot done | `{ note? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/slots/:id/skip` | Skip slot | `{ reason? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/assign` | Assign a task to a slot | `{ taskId, slotId }` | `ScheduleSlot` |
| `DELETE` | `/api/schedule/slots/:id/task` | Unassign the task from a slot | — | `ScheduleSlot` |

**Notes:**
- `POST /generate` returns `409` if a plan already exists for that week.
- `POST /assign` sets `slot.type = 'task'`, `slot.status = 'pending'`, `task.status = 'assigned'`, and `task.slotId` in a transaction.
- `DELETE /slots/:id/task` returns `400` if the slot has no assigned task. Clears `slot.taskId`, resets `slot.status = 'pending'`, and resets `task.status = 'pending'` + clears `task.slotId` in a transaction.
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
- `stats` — `{ total, pending, assigned, inProgress, done, blocked, cancelled }`
- `weekSummary` — `{ weekPlan, totalSlots, taskSlots, doneSlots, skippedSlots, pendingSlots, allocations }` or `null` if no plan for current week

---

## Agents

CRUD for OpenClaw agents. The `agents` DB table is the source of truth for reads; writes go through the table **and** the `openclaw` CLI (write-through). Use `POST /api/agents/sync` as an escape hatch if the two drift.

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/agents` | List all configured agents | — | `OpenclawAgent[]` |
| `GET` | `/api/agents/:id` | Get a single agent | — | `OpenclawAgent` |
| `POST` | `/api/agents` | Create a new isolated agent | `{ name, model, systemPrompt? }` | `201 OpenclawAgent` |
| `PATCH` | `/api/agents/:id` | Update editable fields | `{ systemPrompt?: string \| null }` | `OpenclawAgent` |
| `DELETE` | `/api/agents/:id` | Delete an agent and prune its workspace/state | — | `204` |
| `POST` | `/api/agents/sync` | Reconcile the DB against the `openclaw` CLI | — | `OpenclawAgent[]` |

**Notes:**
- `name` is normalized to an `id` (lowercase, alphanumeric + hyphens) used as the agent identifier and workspace folder name.
- Each new agent gets its own workspace at `~/.openclaw/agents/<id>/workspace`. When `systemPrompt` is provided it is written to `SOUL.md` in that workspace (OpenClaw's convention for agent personality/identity).
- **Only `systemPrompt` is editable.** `PATCH` rewrites `SOUL.md` in the agent's workspace and updates the DB row. Passing `systemPrompt: null` or `""` clears the prompt (removes `SOUL.md`). `name` and `model` are immutable — to change them, delete and recreate the agent.
- If the `agents` table is empty on a `GET`, the service bootstraps it from the CLI automatically — this is the first-run seed path.
- `POST /api/agents/sync` upserts every agent reported by `openclaw agents list` and removes DB rows that no longer exist in the CLI.
- Deleting the default agent (`isDefault: true`) returns a `400`. Deleting an unknown id returns `404`.

---

## Error Handling

Errors are handled globally in `src/index.ts`:

| Error type | HTTP status | Shape |
|-----------|------------|-------|
| `AppError` | `statusCode` from the error | `{ error: string, details?: unknown }` |
| `ZodError` | `400` | `{ error: "Validation failed", details: <flatten()> }` |
| Unhandled | `500` | `{ error: "Internal server error" }` |
