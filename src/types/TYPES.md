# Types

## Contents

- [Constants](#constants)
  - [`FOCUS_ICONS`](#focus_icons)
  - [`FOCUS_ORDER`](#focus_order)
- [Utility Functions](#utility-functions)
  - [`now()`](#now)
  - [`today()`](#today)
  - [`deriveDisplayName`](#derivedisplaynameemoji-name)
- [Error Utilities](#error-utilities)
  - [`AppError`](#apperror)
  - [`notFound`](#notfoundentity-id)
- [Zod Validation Schemas](#zod-validation-schemas)
  - [Goal Schemas](#goal-schemas)
  - [Initiative Schemas](#initiative-schemas)
  - [Task Schemas](#task-schemas)
  - [Requirement Schemas](#requirement-schemas)
  - [Test Schemas](#test-schemas)
  - [Output Schema](#output-schema)
  - [Schedule Schemas](#schedule-schemas)
  - [Agent Schemas](#agent-schemas)
- [Inferred TypeScript Types](#inferred-typescript-types)

---

All shared types, Zod schemas, constants, and utilities are defined in [index.types.ts](index.types.ts).

---

## Constants

### `FOCUS_ICONS`

```ts
const FOCUS_ICONS = {
  sprint: '🔵',
  steady: '🟢',
  simmer: '🟡',
  dormant: '⚪️',
}
```

Maps a focus level to its display icon. Used in `createGoal` and `updateGoal` to derive the `focusIcon` field — never stored independently of `focus`.

### `FOCUS_ORDER`

```ts
const FOCUS_ORDER = {
  sprint: 0,
  steady: 1,
  simmer: 2,
  dormant: 3,
}
```

Numeric mapping used by the goals service to produce the correct `ORDER BY` expression (`sprint` first, `dormant` last).

---

## Utility Functions

### `now()`

```ts
function now(): string
```

Returns the current time as a full ISO 8601 timestamp string (`YYYY-MM-DDTHH:mm:ss.sssZ`). Used for `updatedAt`, `completedAt`, etc.

### `today()`

```ts
function today(): string
```

Returns the current date as `YYYY-MM-DD`. Used for `createdAt` on goals and tasks.

### `deriveDisplayName(emoji, name)`

```ts
function deriveDisplayName(emoji: string, name: string): string
// → `${emoji} ${name}`
```

Single source of truth for the `displayName` field across all entities.

---

## Error Utilities

### `AppError`

```ts
class AppError extends Error {
  statusCode: number;
  details?: unknown;
}
```

Thrown by service functions for expected, handleable errors (not found, invalid input, state conflicts). The global Fastify error handler in `src/index.ts` catches `AppError` and returns `{ error: message, details? }` with the appropriate HTTP status code.

### `notFound(entity, id)`

```ts
function notFound(entity: string, id: string): AppError
// → AppError(404, `${entity} not found: ${id}`)
```

Convenience factory used throughout services when a DB lookup returns no rows.

---

## Zod Validation Schemas

All schemas are used directly in route handlers via `.parse(request.body)`.

### Goal Schemas

#### `CreateGoalSchema`

```ts
{
  emoji: string (min 1),
  name: string (min 1),
  focus?: 'sprint' | 'steady' | 'simmer' | 'dormant',  // default: 'steady'
  timeline?: string,
  story?: string,
}
```

#### `UpdateGoalSchema`

```ts
{
  emoji?: string,
  name?: string,
  focus?: 'sprint' | 'steady' | 'simmer' | 'dormant',
  timeline?: string | null,   // null = clear the field
  story?: string | null,       // null = clear the field
  sortOrder?: number (integer),
}
```

---

### Initiative Schemas

#### `CreateInitiativeSchema`

```ts
{
  emoji: string (min 1),
  name: string (min 1),
  goalId?: string,
  mission?: string,
  status?: 'active' | 'backlog' | 'paused' | 'completed',  // default: 'active'
}
```

#### `UpdateInitiativeSchema`

```ts
{
  emoji?: string,
  name?: string,
  status?: 'active' | 'backlog' | 'paused' | 'completed',
  mission?: string | null,
  goalId?: string | null,
  sortOrder?: number (integer),
}
```

---

### Task Schemas

#### `CreateTaskSchema`

```ts
{
  name: string (min 1),
  initiativeId?: string,
  objective: string (min 1),
  requirements?: string[],     // default: []
  tests?: string[],            // default: []
}
```

#### `UpdateTaskSchema`

```ts
{
  name?: string,
  objective?: string,
  status?: 'pending' | 'assigned' | 'in-progress' | 'done' | 'blocked' | 'cancelled',
  sortOrder?: number (integer),
}
```

#### `DoneTaskSchema`

Used by `POST /api/tasks/:id/done`.

```ts
{
  summary: string (min 1),
  outputs?: Array<{ label: string, url?: string }> | null,  // default: []
}
```

#### `BlockTaskSchema`

Used by `POST /api/tasks/:id/block`.

```ts
{
  reason: string (min 1),
}
```

---

### Requirement Schemas

#### `AddRequirementSchema`

```ts
{ description: string (min 1) }
```

#### `UpdateRequirementSchema`

```ts
{ description?: string, completed?: boolean }
```

---

### Test Schemas

#### `AddTestSchema`

```ts
{ description: string (min 1) }
```

#### `UpdateTestSchema`

```ts
{ description?: string, passed?: boolean }
```

---

### Output Schema

#### `AddOutputSchema`

```ts
{ label: string (min 1), url?: string }
```

---

### Schedule Schemas

#### `GenerateWeekPlanSchema`

```ts
{ weekStart?: string }  // YYYY-MM-DD; defaults to current week's Sunday if omitted
```

#### `UpdateSlotSchema`

```ts
{
  status?: 'pending' | 'in-progress' | 'done' | 'skipped',
  taskId?: string | null,
  note?: string | null,
}
```

#### `DoneSlotSchema`

```ts
{ note?: string }
```

#### `SkipSlotSchema`

```ts
{ reason?: string }
```

#### `AssignTaskSchema`

```ts
{ taskId: string (min 1), slotId: string (min 1) }
```

### Agent Schemas

#### `CreateAgentSchema`

```ts
{
  name: string (min 1),
  model: string (min 1),
  systemPrompt?: string,
}
```

Input for `POST /api/agents`. `name` is normalized to an agent id (lowercase, alphanumeric + hyphens) by the service layer. `model` must be an OpenClaw-recognized model key (e.g. `github-copilot/claude-sonnet-4`). `systemPrompt`, when provided, is written to the new agent's workspace as `SOUL.md`.

#### `UpdateAgentSchema`

```ts
{
  systemPrompt?: string | null,   // null or "" clears SOUL.md
}
```

Input for `PATCH /api/agents/:id`. Only `systemPrompt` is editable; `name` and `model` are immutable once the agent is created. The service rewrites `SOUL.md` in the agent's workspace and mirrors the value into the DB row.

---

## Inferred TypeScript Types

These are derived from the Zod schemas via `z.infer<>` and used as function parameter types in service files.

| Type | Source schema |
|------|--------------|
| `CreateGoalInput` | `CreateGoalSchema` |
| `UpdateGoalInput` | `UpdateGoalSchema` |
| `CreateInitiativeInput` | `CreateInitiativeSchema` |
| `UpdateInitiativeInput` | `UpdateInitiativeSchema` |
| `CreateTaskInput` | `CreateTaskSchema` |
| `UpdateTaskInput` | `UpdateTaskSchema` |
| `DoneTaskInput` | `DoneTaskSchema` |
| `BlockTaskInput` | `BlockTaskSchema` |
| `GenerateWeekPlanInput` | `GenerateWeekPlanSchema` |
| `UpdateSlotInput` | `UpdateSlotSchema` |
| `DoneSlotInput` | `DoneSlotSchema` |
| `SkipSlotInput` | `SkipSlotSchema` |
| `AssignTaskInput` | `AssignTaskSchema` |
| `CreateAgentInput` | `CreateAgentSchema` |
| `UpdateAgentInput` | `UpdateAgentSchema` |
