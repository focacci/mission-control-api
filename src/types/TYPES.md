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
  - [Requirement Test Schemas](#requirement-test-schemas)
  - [Agent Assignment Schemas](#agent-assignment-schemas)
  - [Schedule Schemas](#schedule-schemas)
  - [Slot Output Schema](#slot-output-schema)
  - [Agent Schemas](#agent-schemas)
  - [Chat Schemas](#chat-schemas)
  - [Conversation Schemas](#conversation-schemas)
  - [Invocation Schemas](#invocation-schemas)
  - [Profile Schemas](#profile-schemas)
  - [Context Group Schemas](#context-group-schemas)
  - [Brief Schemas](#brief-schemas)
- [Constants (Phase 1)](#constants-phase-1)
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
}
```

#### `UpdateTaskSchema`

```ts
{
  name?: string,
  objective?: string,
  status?: 'pending' | 'in-progress' | 'done' | 'blocked' | 'cancelled',
  sortOrder?: number (integer),
}
```

#### `DoneTaskSchema`

Used by `POST /api/tasks/:id/done`.

```ts
{
  summary: string (min 1),
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

### Requirement Test Schemas

#### `AddRequirementTestSchema`

```ts
{ description: string (min 1) }
```

#### `UpdateRequirementTestSchema`

```ts
{ description?: string, passed?: boolean }
```

---

### Agent Assignment Schemas

#### `CreateAgentAssignmentSchema`

```ts
{
  name: string (min 1),
  agentId?: string,
  instructions?: string,
}
```

Input for `POST /api/goals/:goalId/agent-assignments`, `POST /api/initiatives/:initiativeId/agent-assignments`, and `POST /api/tasks/:taskId/agent-assignments`. The parent kind is determined by the route — the request body is identical for all three.

#### `UpdateAgentAssignmentSchema`

```ts
{
  name?: string,
  agentId?: string | null,
  instructions?: string | null,
  sortOrder?: number (integer),
}
```

Input for `PATCH /api/agent-assignments/:id`. Passing `null` for `agentId` or `instructions` clears the field.

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
  agentAssignmentId?: string | null,
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

#### `AssignAgentAssignmentSchema`

```ts
{ agentAssignmentId: string (min 1), slotId: string (min 1) }
```

---

### Slot Output Schema

#### `AddSlotOutputSchema`

```ts
{ label: string (min 1), url?: string }
```

Used by `POST /api/schedule/slots/:id/outputs`.

---

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

### Chat Schemas

#### `ChatContextSchema`

```ts
{
  type: string (min 1),
  id?: string,
  name?: string,
  emoji?: string,
  section?: string,
  date?: string,
}
```

Optional view header attached to a chat turn so the agent knows what the user is looking at. Serialized into the prompt as a single `[Context: …]` line.

#### `ChatRequestSchema`

```ts
{
  message: string (min 1),
  agentId?: string,
  context?: ChatContext,
  sessionId?: string,
}
```

Body schema for `POST /api/chat`. `agentId` defaults to `intella` at the service layer. If `sessionId` is provided and exists, it's reused; otherwise the service dedups by `(agentId, context.type, context.id)`.

---

### Conversation Schemas

#### `CreateSessionSchema`

```ts
{
  agentId: string (min 1),
  contextType?: string | null,
  contextId?: string | null,
  title?: string | null,
}
```

Not exposed on a route in Phase 1 (sessions are created implicitly by the chat orchestrator) but kept for internal consumers and forthcoming admin endpoints.

#### `ListSessionsQuerySchema`

```ts
{
  agentId?: string,
  contextType?: string,
  contextId?: string,
  limit?: number (int, 1..200, coerced from string),
}
```

Query schema for `GET /api/chat/sessions`. `limit` defaults to 50 at the service layer when omitted.

#### `ListMessagesQuerySchema`

```ts
{
  limit?: number (int, 1..500, coerced),
  before?: string,   // messageId anchor for reverse-chronological paging
}
```

Query schema for `GET /api/chat/sessions/:id/messages`.

---

### Invocation Schemas

#### `ListInvocationsQuerySchema`

```ts
{
  trigger?: 'slot_start' | 'brief' | 'user_chat' | 'manual',
  status?: 'running' | 'complete' | 'error' | 'timeout' | 'cancelled',
  limit?: number (int, 1..200, coerced),
  since?: string,    // ISO timestamp filter on started_at
}
```

Query schema for `GET /api/invocations`.

### Profile Schemas

#### `UpdateProfileSectionSchema`

```ts
{
  summary?: string | null,
  sortOrder?: number (int),
}
```

Body for `PATCH /api/profile/sections/:sectionId`. `null` explicitly clears `summary`.

#### `AddProfileEntrySchema`

```ts
{
  label: string (min 1),
  detail?: string | null,
  confidence?: 'observed' | 'inferred' | 'stated',
  source?: string | null,
  sortOrder?: number (int),
}
```

Body for `POST /api/profile/sections/:sectionId/entries`. `confidence` defaults to `observed` in the service.

#### `UpdateProfileEntrySchema`

```ts
{
  label?: string (min 1),
  detail?: string | null,
  confidence?: 'observed' | 'inferred' | 'stated',
  source?: string | null,
  sortOrder?: number (int),
}
```

Body for `PATCH /api/profile/entries/:entryId`.

### Context Group Schemas

#### `CreatePinnedContextSchema`

```ts
{
  contextType: string (min 1),
  contextId?: string | null,
  label: string (min 1),
  icon: string (min 1),
  typeName: string (min 1),
  payload?: string | null,   // JSON blob
  sortOrder?: number (int),
}
```

Body for `POST /api/pinned-contexts`.

#### `CreateContextGroupSchema`

```ts
{
  name: string (min 1),
  icon?: string (min 1),
  summary?: string | null,
  members?: NewContextRef[],
}
```

Body for `POST /api/context-groups`. A `NewContextRef` matches `CreatePinnedContextSchema`.

#### `UpdateContextGroupSchema`

```ts
{
  name?: string (min 1),
  icon?: string (min 1),
  summary?: string | null,
  sortOrder?: number (int),
}
```

Body for `PATCH /api/context-groups/:id`.

#### `AddContextGroupMemberSchema`

Same shape as `CreatePinnedContextSchema`. Body for `POST /api/context-groups/:id/members`.

### Brief Schemas

#### `ListBriefsQuerySchema`

```ts
{
  from: string (YYYY-MM-DD),
  to:   string (YYYY-MM-DD),
}
```

Query for `GET /api/briefs`. Both dates are required; service throws `400` if `from > to`.

#### `GenerateBriefSchema`

```ts
{
  date: string (YYYY-MM-DD),
  kind: 'morning' | 'afternoon' | 'evening',
}
```

Body for `POST /api/briefs/generate`.

#### `UpdateBriefSchema`

```ts
{
  title?:      string | null,
  body?:       string | null,
  references?: string | null,   // JSON blob
  status?:     'pending' | 'generating' | 'ready' | 'error',
}
```

Body for `PATCH /api/briefs/:id`. Passing `null` explicitly clears the nullable fields.

---

## Constants (Phase 1)

### `INVOCATION_TRIGGERS`

```ts
const INVOCATION_TRIGGERS = ['slot_start', 'brief', 'user_chat', 'manual'] as const;
```

Source of truth for the `agent_invocations.trigger` enum. Shared by the Zod schema and the service layer.

### `INVOCATION_STATUSES`

```ts
const INVOCATION_STATUSES = ['running', 'complete', 'error', 'timeout', 'cancelled'] as const;
```

Source of truth for the `agent_invocations.status` enum.

### `PROFILE_CONFIDENCE`

```ts
const PROFILE_CONFIDENCE = ['observed', 'inferred', 'stated'] as const;
```

Source of truth for the `profile_entries.confidence` enum.

### `BRIEF_KINDS`

```ts
const BRIEF_KINDS = ['morning', 'afternoon', 'evening'] as const;
```

Source of truth for the `briefs.kind` enum.

### `BRIEF_STATUSES`

```ts
const BRIEF_STATUSES = ['pending', 'generating', 'ready', 'error'] as const;
```

Source of truth for the `briefs.status` enum.

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
| `AssignAgentAssignmentInput` | `AssignAgentAssignmentSchema` |
| `AddSlotOutputInput` | `AddSlotOutputSchema` |
| `AddRequirementTestInput` | `AddRequirementTestSchema` |
| `UpdateRequirementTestInput` | `UpdateRequirementTestSchema` |
| `CreateAgentAssignmentInput` | `CreateAgentAssignmentSchema` |
| `UpdateAgentAssignmentInput` | `UpdateAgentAssignmentSchema` |
| `CreateAgentInput` | `CreateAgentSchema` |
| `UpdateAgentInput` | `UpdateAgentSchema` |
| `ChatContextInput` | `ChatContextSchema` |
| `ChatRequestInput` | `ChatRequestSchema` |
| `CreateSessionInputZ` | `CreateSessionSchema` |
| `ListSessionsQuery` | `ListSessionsQuerySchema` |
| `ListMessagesQuery` | `ListMessagesQuerySchema` |
| `ListInvocationsQuery` | `ListInvocationsQuerySchema` |
| `UpdateProfileSectionInput` | `UpdateProfileSectionSchema` |
| `AddProfileEntryInput` | `AddProfileEntrySchema` |
| `UpdateProfileEntryInput` | `UpdateProfileEntrySchema` |
| `CreatePinnedContextInput` | `CreatePinnedContextSchema` |
| `CreateContextGroupInput` | `CreateContextGroupSchema` |
| `UpdateContextGroupInput` | `UpdateContextGroupSchema` |
| `AddContextGroupMemberInput` | `AddContextGroupMemberSchema` |
| `ListBriefsQuery` | `ListBriefsQuerySchema` |
| `GenerateBriefInput` | `GenerateBriefSchema` |
| `UpdateBriefInput` | `UpdateBriefSchema` |
