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

## Error Handling

Errors are handled globally in `src/index.ts`:

| Error type | HTTP status | Shape |
|-----------|------------|-------|
| `AppError` | `statusCode` from the error | `{ error: string, details?: unknown }` |
| `ZodError` | `400` | `{ error: "Validation failed", details: <flatten()> }` |
| Unhandled | `500` | `{ error: "Internal server error" }` |
