# Types

## Contents

- [Constants](#constants)
  - [`FOCUS_ICONS`](#focus_icons)
  - [`FOCUS_ORDER`](#focus_order)
- [Utility Functions](#utility-functions)
  - [`APP_TZ`](#app_tz)
  - [`now()`](#now)
  - [`today()`](#today)
  - [`nowLocalParts()`](#nowlocalparts)
  - [`nowLocalDatetime()`](#nowlocaldatetime)
  - [`addDaysISO`](#adddaysisobasedate-n)
  - [`getSundayOf`](#getsundayofdatestr)
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
  - [Agent Output Schemas](#agent-output-schemas)
  - [Schedule Schemas](#schedule-schemas)
  - [Slot Output Schema](#slot-output-schema)
  - [Agent Schemas](#agent-schemas)
  - [Chat Schemas](#chat-schemas)
  - [Conversation Schemas](#conversation-schemas)
  - [Invocation Schemas](#invocation-schemas)
  - [Profile Schemas](#profile-schemas)
  - [Context Group Schemas](#context-group-schemas)
  - [Brief Schemas](#brief-schemas)
  - [Message Part Schemas](#message-part-schemas)
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

### `APP_TZ`

```ts
const APP_TZ: string = process.env.APP_TZ ?? 'America/New_York'
```

The IANA time zone the app treats as the user's local wall clock. Read once at module load. Drives `today()`, `nowLocalParts()`, and `nowLocalDatetime()`.

### `now()`

```ts
function now(): string
```

Returns the current time as a full ISO 8601 UTC timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`). Used for `updatedAt`, `completedAt`, etc. — fields that represent an instant.

### `today()`

```ts
function today(): string
```

Returns today's calendar date as `YYYY-MM-DD` in `APP_TZ`. Used for `createdAt` on goals, initiatives, tasks, and agent assignments.

### `nowLocalParts()`

```ts
function nowLocalParts(): { date: string; time: string; datetime: string }
```

Returns the current wall-clock instant in `APP_TZ` as three parallel forms: `date` = `YYYY-MM-DD`, `time` = `HH:mm`, `datetime` = `YYYY-MM-DDTHH:mm`. The `datetime` form matches `scheduleSlots.datetime` exactly and is the canonical "what time is it for the user" used by the slot ticker and slot picker.

### `nowLocalDatetime()`

```ts
function nowLocalDatetime(): string
```

Convenience for `nowLocalParts().datetime`. Used by `findDueSlots` and `findNextAvailableSlot` to compare against the wall-clock-string `scheduleSlots.datetime` column.

### `addDaysISO(baseDate, n)`

```ts
function addDaysISO(baseDate: string, n: number): string
```

Adds `n` days to a `YYYY-MM-DD` string. Pure UTC-int math — independent of server TZ and DST. Negative `n` subtracts days.

### `getSundayOf(dateStr?)`

```ts
function getSundayOf(dateStr?: string): string
```

Returns the `YYYY-MM-DD` of the Sunday on or before `dateStr` (defaults to `today()`). Used by the schedule and board services to anchor week plans. Pure UTC-int math.

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
  status?: 'pending' | 'done',
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

Tasks have no `BlockTaskSchema` — task lifecycle is binary (`pending` / `done`). Block/in-progress/etc. live on agent assignments.

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
  title: string (min 1),
  description?: string | null,
  agentId?: string | null,
}
```

Input for `POST /api/goals/:goalId/agent-assignments`, `POST /api/initiatives/:initiativeId/agent-assignments`, and `POST /api/tasks/:taskId/agent-assignments`. The parent kind is determined by the route — the request body is identical for all three.

#### `UpdateAgentAssignmentSchema`

```ts
{
  title?: string,
  description?: string | null,
  agentId?: string | null,
  sortOrder?: number (integer),
}
```

Input for `PATCH /api/agent-assignments/:id`. Passing `null` for `agentId` or `description` clears the field.

#### `BlockAgentAssignmentSchema`

Used by `POST /api/agent-assignments/:id/block`.

```ts
{
  reason?: string,
}
```

#### Lifecycle endpoints (no body)

These endpoints take no body — the action is fully described by the URL:

- `POST /api/agent-assignments/:id/start` → `pending` | `blocked` → `in-progress`
- `POST /api/agent-assignments/:id/complete` → `in-progress` → `done`
- `POST /api/agent-assignments/:id/reopen` → `done` | `blocked` → `pending`
- `POST /api/agent-assignments/:id/unassign` → any → `pending`, also clears every schedule slot referencing this AA

#### `AGENT_ASSIGNMENT_STATUSES`

```ts
const AGENT_ASSIGNMENT_STATUSES = ['pending', 'scheduled', 'in-progress', 'done', 'blocked'] as const;
type AgentAssignmentStatus = (typeof AGENT_ASSIGNMENT_STATUSES)[number];
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
  agentAssignmentId?: string | null,
  note?: string | null,
  extraPrompt?: string | null,
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

### Agent Output Schemas

Schemas governing the structured record of one autonomous Agent Assignment run. See `agent_outputs` and `agent_output_steps` in SCHEMAS.md.

#### `AGENT_OUTPUT_STATUSES`

```ts
const AGENT_OUTPUT_STATUSES = ['running', 'complete', 'error', 'cancelled'] as const;
type AgentOutputStatus = (typeof AGENT_OUTPUT_STATUSES)[number];
```

#### `AGENT_OUTPUT_STEP_KINDS`

```ts
const AGENT_OUTPUT_STEP_KINDS = ['thinking', 'tool_call', 'text'] as const;
type AgentOutputStepKind = (typeof AGENT_OUTPUT_STEP_KINDS)[number];
```

#### `CreateAgentOutputSchema`

```ts
{ input: string (min 1), agentId?: string | null, model?: string | null }
```

Opens a new running output. `agentId` defaults to the parent assignment's `agentId`.

#### `AppendAgentOutputStepSchema`

A discriminated union on `kind`:

```ts
{ kind: 'thinking', content: string }
| { kind: 'text',     content: string }
| { kind: 'tool_call',
    toolName: string (min 1),
    toolInput: unknown,         // serialized via JSON.stringify in the service
    toolOutput?: string | null,
    isError?: boolean,
    durationMs?: number (int >= 0)
  }
```

#### `CompleteAgentOutputSchema`

```ts
{ response: string, tokensIn?: number (int >= 0), tokensOut?: number (int >= 0) }
```

Both token fields default to `0`.

#### `FailAgentOutputSchema`

```ts
{ error: string (min 1), status?: 'error' | 'cancelled' }
```

`status` defaults to `'error'`.

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
  briefId?: string,
  date?:    string (YYYY-MM-DD),
  kind?:    'morning' | 'afternoon' | 'evening',
}
```

Body for `POST /api/briefs/generate`. Provide either `briefId` or both `date` and `kind`. Phase 2 ships without LLM synthesis, so this endpoint just freezes the brief at its current evidence with a deterministic fallback summary.

#### `UpdateBriefSchema`

```ts
{
  title?:      string | null,
  body?:       string | null,
  references?: string | null,   // JSON blob
  status?:     'pending' | 'drafting' | 'ready' | 'acknowledged' | 'error',
}
```

Body for `PATCH /api/briefs/:id`. Passing `null` explicitly clears the nullable fields.

#### `BriefBodySchema` / `BriefReferencesSchema`

```ts
type BriefBody = {
  summary: string;
  sections: {
    agentWork:           BriefAgentWorkItem[];
    openQuestions:       BriefQuestionItem[];
    userAccomplishments: BriefAccomplishmentItem[];
    profileGaps:         BriefProfileGapItem[];
    worldSignal:         BriefWorldSignalItem[];
  };
};

type BriefReferences = {
  agentOutputIds:    string[];
  invocationIds:     string[];
  taskIds:           string[];
  requirementIds:    string[];
  profileEntryIds:   string[];
  profileSectionIds: string[];
  slotIds:           string[];
  chatMessageIds:    string[];
  urls:              string[];
  synthesisFailed?:  boolean;
};
```

JSON shape for the `briefs.body` and `briefs.references` columns. `EMPTY_BRIEF_BODY` and `EMPTY_BRIEF_REFERENCES` constants provide initial values.

#### `BriefEvidenceItemSchema`

Discriminated union (`kind`) for items the agent or in-app hooks append to a draft brief:

```ts
{ kind: 'agent_work';      agentOutputId; agentAssignmentId?; agentId?; agentName?;
                            agentEmoji?; title; oneLineSummary?; tokensIn; tokensOut;
                            durationMs?; endedAt }
{ kind: 'open_question';   questionId; prompt; source: 'agent_output'|'invocation'|'chat'|'manual';
                            agentOutputId?; invocationId?; chatMessageId?; raisedAt }
{ kind: 'accomplishment';  source: 'task'|'requirement'|'slot'|'status_strip'|'daily_note'|'chat';
                            refId; title; detail?; occurredAt }
{ kind: 'profile_gap';     profileSectionId; profileEntryId?; prompt; raisedAt }
{ kind: 'world_signal';    provider; headline; detail?; url?; occurredAt }
```

#### `AppendBriefEvidenceSchema`

```ts
{ item: BriefEvidenceItem }
```

Body for `POST /api/briefs/:id/evidence`.

#### `DailyRhythmEntryDetailSchema`

```ts
{
  start:      string (HH:MM),
  end:        string (HH:MM),
  userActive: boolean,
}
```

Stored as a JSON string in `profile_entries.detail` for entries under the `daily_rhythm` section. Read via `profile.service.getDailyRhythm()`.

### Message Part Schemas

Structured render schema persisted on `chat_messages.parts` (MCP_TOOLKIT_PLAN Bucket 2a). Every assistant or user turn is a list of parts; the iOS client switches on `kind` to pick a renderer. Bucket 2b interface tools (`render_card`, `prompt_user`, `navigate`, `attach`, …) emit additional parts onto the in-flight assistant message.

`MessagePartSchema` is a discriminated union (`kind`) of:

```ts
{ kind: 'text';            text: string }
{ kind: 'card';            cardType: CardKind; entityId: string }
{ kind: 'prompt';          promptType: 'confirm' | 'choice'; question: string;
                            promptId: string; choices?: { id; label; emoji? }[] }
{ kind: 'prompt_reply';    promptId: string; choiceId: string }
{ kind: 'quick_replies';   suggestions: { id: string; label: string }[] }
{ kind: 'navigate';        route: string; label: string }
{ kind: 'attachment';      mimeType: string; name: string; url: string; size?: number }
{ kind: 'live_activity_ref'; activityId: string; title: string }
```

`CardKind` covers `task | goal | initiative | agent_assignment | slot | schedule_day`. Helpers `partsToText(parts)` and `textToParts(content)` provide round-trips between `parts` and the legacy `chat_messages.content` column.

#### `HydrateCardsSchema`

```ts
{
  cards: { cardType: CardKind; entityId: string }[]   // max 200
}
```

Body schema for `POST /api/cards/hydrate`. Each tuple matches the payload of a `card` part — bulk hydration replaces n round-trips to per-kind GETs with a single response keyed by `cardType`.

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
const BRIEF_STATUSES = ['pending', 'drafting', 'ready', 'acknowledged', 'error'] as const;
```

Source of truth for the `briefs.status` enum. Lifecycle: `pending → drafting → ready → acknowledged`; `error` set by the synthesis pipeline.

### `BRIEF_REVEAL_TIMES`

```ts
const BRIEF_REVEAL_TIMES = {
  morning:   '07:00',
  afternoon: '12:30',
  evening:   '19:00',
} as const;
```

Reveal-time labels per the brief reveal table. Used by `briefs.service.computeBriefWindow` to seed `revealAt` / `windowStart` / `windowEnd` on stub creation.

### `DAILY_RHYTHM_SECTION_ID` / `DAILY_RHYTHM_PHASES` / `DEFAULT_DAILY_RHYTHM`

```ts
const DAILY_RHYTHM_SECTION_ID = 'daily_rhythm';
const DAILY_RHYTHM_PHASES = ['morning', 'afternoon', 'evening', 'overnight'] as const;
const DEFAULT_DAILY_RHYTHM = {
  morning:   { start: '04:30', end: '12:30', userActive: true  },
  afternoon: { start: '12:30', end: '17:00', userActive: true  },
  evening:   { start: '17:00', end: '21:00', userActive: true  },
  overnight: { start: '21:00', end: '04:30', userActive: false },
};
```

Defaults seeded by `profile.service.ensureDailyRhythmSeeded()`. Used as the fallback for any phase that's missing or has malformed JSON when reading via `getDailyRhythm()`.

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
| `BlockAgentAssignmentInput` | `BlockAgentAssignmentSchema` |
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
| `CreateAgentOutputInput` | `CreateAgentOutputSchema` |
| `AppendAgentOutputStepInput` | `AppendAgentOutputStepSchema` |
| `CompleteAgentOutputInput` | `CompleteAgentOutputSchema` |
| `FailAgentOutputInput` | `FailAgentOutputSchema` |
| `CreateAgentInput` | `CreateAgentSchema` |
| `UpdateAgentInput` | `UpdateAgentSchema` |
| `ChatContextInput` | `ChatContextSchema` |
| `ChatRequestInput` | `ChatRequestSchema` |
| `HydrateCardsInput` | `HydrateCardsSchema` |
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
| `BriefStatus` | `BRIEF_STATUSES` (enum) |
| `BriefKind` | `BRIEF_KINDS` (enum) |
| `BriefBody` | `BriefBodySchema` |
| `BriefReferences` | `BriefReferencesSchema` |
| `BriefEvidenceItem` | `BriefEvidenceItemSchema` |
| `BriefAgentWorkItem` | `BriefAgentWorkItemSchema` |
| `BriefQuestionItem` | `BriefQuestionItemSchema` |
| `BriefAccomplishmentItem` | `BriefAccomplishmentItemSchema` |
| `BriefProfileGapItem` | `BriefProfileGapItemSchema` |
| `BriefWorldSignalItem` | `BriefWorldSignalItemSchema` |
| `AppendBriefEvidenceInput` | `AppendBriefEvidenceSchema` |
| `DailyRhythmEntryDetail` | `DailyRhythmEntryDetailSchema` |
| `DailyRhythmPhase` | `DAILY_RHYTHM_PHASES` (enum) |
