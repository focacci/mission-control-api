# Services

## Contents

- [Goals Service](#goals-service)
  - [`listGoals`](#listgoalsopts)
  - [`getGoal`](#getgoalid)
  - [`createGoal`](#creategoalinput)
  - [`updateGoal`](#updategoalid-input)
  - [`deleteGoal`](#deletegoalid)
- [Initiatives Service](#initiatives-service)
  - [`listInitiatives`](#listinitiativesopts)
  - [`getInitiative`](#getinitiativeid)
  - [`createInitiative`](#createinitiativeinput)
  - [`updateInitiative`](#updateinitiativeid-input)
  - [`completeInitiative`](#completeinitiativeid)
  - [`deleteInitiative`](#deleteinitiativeid)
- [Tasks Service](#tasks-service)
  - [`listTasks`](#listtasksopts)
  - [`getTask`](#gettaskid)
  - [`createTask`](#createtaskinput)
  - [`updateTask`](#updatetaskid-input)
  - [`startTask`](#starttaskid)
  - [`doneTask`](#donetaskid-input)
  - [`blockTask`](#blocktaskid-input)
  - [`cancelTask`](#canceltaskid)
  - [`deleteTask`](#deletetaskid)
  - [Requirements](#requirements)
  - [Tests](#tests)
  - [Outputs](#outputs)
- [Schedule Service](#schedule-service)
  - [`getTodaySlots`](#gettodayslots)
  - [`getWeekSlots`](#getweekslotsweestart)
  - [`generateWeekPlan`](#generateweekplanweestart)
  - [`updateSlot`](#updateslotid-input)
  - [`doneSlot`](#doneslotid-input)
  - [`skipSlot`](#skipslotid-input)
  - [`assignTask`](#assigntasktaskid-slotid)
  - [`unassignTask`](#unassigntaskslotid)
- [Board Service](#board-service)
  - [`getBoard`](#getboard)
- [Agents Service](#agents-service)
  - [`listAgents`](#listagents)
  - [`getAgent`](#getagentid)
  - [`createAgent`](#createagentinput)
  - [`updateAgent`](#updateagentid-input)
  - [`deleteAgent`](#deleteagentid)
  - [`repairAgents`](#repairagents)
- [Chat Service](#chat-service)
  - [`sendMessage`](#sendmessagereq)
- [Conversations Service](#conversations-service)
  - [`createSession`](#createsessioninput)
  - [`findOrCreateSession`](#findorcreatesessioninput)
  - [`getSession`](#getsessionid)
  - [`listSessions`](#listsessionsopts)
  - [`deleteSession`](#deletesessionid)
  - [`appendMessage`](#appendmessageinput)
  - [`listMessages`](#listmessagessessionid-opts)
  - [`getMessageCount`](#getmessagecountsessionid)
- [Invocations Service](#invocations-service)
  - [`startInvocation`](#startinvocationinput)
  - [`completeInvocation`](#completeinvocationid-input)
  - [`failInvocation`](#failinvocationid-input)
  - [`listInvocations`](#listinvocationsopts)
  - [`getInvocation`](#getinvocationid)
  - [`getTodayTokenUsage`](#gettodaytokenusage)
- [Tool Calls Service](#tool-calls-service)
  - [`recordToolCallStart`](#recordtoolcallstartinput)
  - [`recordToolCallResult`](#recordtoolcallresultid-input)

---

Services contain all database interaction and business logic. Route handlers parse and validate input, then call service functions. Services throw `AppError` on expected failures (not found, validation errors, state conflicts).

---

## Goals Service

Manages goal records. All queries exclude no rows by default (no soft-delete — deletes are hard).

### `listGoals(opts)`

```ts
listGoals(opts: { focus?: string }): Promise<Goal[]>
```

Returns all goals, ordered by focus level (`sprint → steady → simmer → dormant`) then `sortOrder` ascending. Optionally filtered by `focus`. Throws `AppError(400)` for an unrecognised focus value.

### `getGoal(id)`

```ts
getGoal(id: string): Promise<Goal & { initiatives: Initiative[] }>
```

Returns a single goal with its child initiatives sorted by `sortOrder`. Throws `AppError(404)` if not found.

### `createGoal(input)`

```ts
createGoal(input: CreateGoalInput): Promise<Goal>
```

Derives `focusIcon` from `focus` and computes `displayName = emoji + ' ' + name`. Inserts and returns the new row. `createdAt` is an ISO date (`YYYY-MM-DD`); `updatedAt` is a full ISO timestamp.

### `updateGoal(id, input)`

```ts
updateGoal(id: string, input: UpdateGoalInput): Promise<Goal>
```

Merges partial input over the existing row. `displayName` and `focusIcon` are always recomputed. Passing `timeline: null` or `story: null` explicitly clears those fields. Returns the updated row.

### `deleteGoal(id)`

```ts
deleteGoal(id: string): Promise<void>
```

Hard-delete executed in a synchronous SQLite transaction:
1. Finds all initiatives under the goal.
2. Hard-deletes all tasks belonging to those initiatives.
3. Hard-deletes the initiatives.
4. Hard-deletes the goal.

Throws `AppError(404)` if the goal does not exist.

---

## Initiatives Service

Manages initiative records.

### `listInitiatives(opts)`

```ts
listInitiatives(opts: { goalId?: string; status?: string }): Promise<Initiative[]>
```

Returns all initiatives optionally filtered by `goalId` and/or `status`, sorted by `sortOrder`. Throws `AppError(400)` for an invalid status value.

### `getInitiative(id)`

```ts
getInitiative(id: string): Promise<Initiative & { goal: Goal | null; tasks: Task[] }>
```

Returns a single initiative with its parent goal (or `null` if unlinked) and child tasks sorted by `sortOrder`. Throws `AppError(404)` if not found.

### `createInitiative(input)`

```ts
createInitiative(input: CreateInitiativeInput): Promise<Initiative>
```

Computes `displayName` and inserts the row. `status` defaults to `active`.

### `updateInitiative(id, input)`

```ts
updateInitiative(id: string, input: UpdateInitiativeInput): Promise<Initiative>
```

Merges partial input. `displayName` is recomputed whenever `emoji` or `name` changes. `mission: null` and `goalId: null` explicitly clear those fields.

### `completeInitiative(id)`

```ts
completeInitiative(id: string): Promise<Initiative>
```

Sets the initiative's `status` to `completed` and bulk-cancels all tasks still in `pending`, `assigned`, `in-progress`, or `blocked`. Both updates share the same timestamp.

### `deleteInitiative(id)`

```ts
deleteInitiative(id: string): Promise<void>
```

Hard-delete in a synchronous transaction: deletes all tasks under the initiative first, then deletes the initiative. Throws `AppError(404)` if not found.

---

## Tasks Service

Manages tasks and their three sub-collections (requirements, tests, outputs).

### `listTasks(opts)`

```ts
listTasks(opts: {
  initiativeId?: string;
  status?: string | string[];
}): Promise<TaskWithRequirementsAndTests[]>
```

Returns tasks with their `requirements` and `tests` arrays. Supports filtering by `initiativeId` and one or more `status` values. Requirements and tests are loaded in a single bulk query per collection (not N+1). Sorted by `sortOrder`.

### `getTask(id)`

```ts
getTask(id: string): Promise<TaskDetail>
```

Returns full task detail: task row + `requirements`, `tests`, `outputs`, parent `initiative` (or `null`), and `slot: null` (schedule slot resolution not yet implemented). Throws `AppError(404)` if not found.

### `createTask(input)`

```ts
createTask(input: CreateTaskInput): Promise<TaskDetail>
```

- Inserts the task, requirements, and tests in a single synchronous transaction.
- Returns full task detail via `loadTaskDetail`.

### `updateTask(id, input)`

```ts
updateTask(id: string, input: UpdateTaskInput): Promise<TaskDetail>
```

Updates `name`, `objective`, `status`, and/or `sortOrder`. Recomputes `displayName` if `name` changes.

### `startTask(id)`

```ts
startTask(id: string): Promise<TaskDetail>
```

Sets `status → in-progress`. Throws `AppError(409)` if the task is already `done` or `cancelled`.

### `doneTask(id, input)`

```ts
doneTask(id: string, input: DoneTaskInput): Promise<TaskDetail>
```

- Validates that all requirements are checked. Returns `AppError(400)` with `details.incomplete` if any are unchecked.
- Sets `status = done`, records `summary` and `completedAt`.
- Inserts any `outputs` provided in the same transaction.
- Throws `AppError(409)` if the task is `cancelled`.

### `blockTask(id, input)`

```ts
blockTask(id: string, input: BlockTaskInput): Promise<TaskDetail>
```

Sets `status = blocked` and stores the block reason in `summary`. Throws `AppError(409)` if the task is `done` or `cancelled`.

### `cancelTask(id)`

```ts
cancelTask(id: string): Promise<TaskDetail>
```

Sets `status = cancelled`. Throws `AppError(409)` if the task is already `done`.

### `deleteTask(id)`

```ts
deleteTask(id: string): Promise<void>
```

Hard-deletes the task row. Child requirements, tests, and outputs are removed by `ON DELETE CASCADE` at the DB level. Throws `AppError(404)` if not found.

---

### Requirements

#### `addRequirement(taskId, description)`

Appends a new unchecked requirement. `sortOrder` is set to the current count of existing requirements.

#### `updateRequirement(taskId, reqId, patch)`

Updates `description` and/or `completed`. Throws `AppError(400)` if the patch is empty.

#### `checkRequirement(taskId, reqId, completed)`

Convenience wrapper around `updateRequirement` that sets only the `completed` boolean.

#### `deleteRequirement(taskId, reqId)`

Removes the requirement. Validates both `taskId` and `reqId` match.

---

### Tests

#### `addTest(taskId, description)`

Appends a new unpassed test. `sortOrder` is set to the current count of existing tests.

#### `updateTest(taskId, testId, patch)`

Updates `description` and/or `passed`. Throws `AppError(400)` if the patch is empty.

#### `deleteTest(taskId, testId)`

Removes the test. Validates both `taskId` and `testId` match.

---

### Outputs

#### `addOutput(taskId, label, url?)`

Appends a new output artifact. `url` is optional.

#### `deleteOutput(taskId, outputId)`

Removes the output. Validates both `taskId` and `outputId` match.

---

## Schedule Service

Manages week plan generation, slot queries, and slot lifecycle.

### `getTodaySlots()`

```ts
getTodaySlots(): Promise<SlotWithTask[]>
```

Returns all slots for today's date (derived at call time). Enriches each slot with its linked task row. Returns empty array if no week plan exists for the current week.

### `getWeekSlots(weekStart)`

```ts
getWeekSlots(weekStart: string): Promise<{ weekPlan, slots: SlotWithTask[], allocations }>
```

Returns the full week plan, all slots with task enrichment, and per-goal allocations. Normalizes `weekStart` to the Sunday of that date. If no plan exists, returns `{ weekPlan: null, slots: [], allocations: [] }` — no generation is triggered.

### `getSlotsInRange(from, to)`

```ts
getSlotsInRange(from: string, to: string): Promise<{ from, to, slots: SlotWithTask[] }>
```

Returns all slots whose `date` is within the inclusive `[from, to]` range, ordered by `datetime`, with task enrichment applied. Throws `AppError(400)` if `from > to`. Unlike `getWeekSlots`, this query is not keyed to a `weekPlans` row — it spans plan boundaries, so it's safe to call for arbitrary ranges (e.g., month grid, year overview).

### `generateWeekPlan(weekStart?)`

```ts
generateWeekPlan(weekStart?: string): Promise<{ weekPlan, slots, allocations }>
```

Creates a complete week plan:
1. Normalizes to the Sunday of the given (or current) date.
2. Throws `AppError(409)` if a plan already exists for that week.
3. Queries all non-dormant goals.
4. Computes per-goal slot allocations (sprint 30 / steady 12 / simmer 4, split evenly within each focus level).
5. Generates 105 slots (15 times × 7 days). Fixed types: `00:00` → `maintenance`, Sunday `02:00` → `planning`, `07:00`/`12:30`/`19:00` → `brief`. All others → `flex`. `fixedSlots = 29` (7 maintenance + 1 planning + 21 briefs).
6. Distributes task-eligible flex slots to goals in allocation order, upgrading them to type `task`.
7. Pulls pending/assigned tasks for each goal and assigns them to that goal's task slots.
8. Marks assigned tasks as `status = 'assigned'`.
9. Persists `weekPlan`, `scheduleSlots`, `weekGoalAllocations`, and task updates in one transaction.

### `updateSlot(id, input)`

```ts
updateSlot(id: string, input: UpdateSlotInput): Promise<ScheduleSlot>
```

Generic patch: updates `status`, `taskId`, and/or `note`. Throws `AppError(404)` if slot not found.

### `doneSlot(id, input)`

```ts
doneSlot(id: string, input: DoneSlotInput): Promise<ScheduleSlot>
```

Sets `status = 'done'` and optionally sets `note`. Throws `AppError(404)` if not found.

### `skipSlot(id, input)`

```ts
skipSlot(id: string, input: SkipSlotInput): Promise<ScheduleSlot>
```

Sets `status = 'skipped'` and stores the reason as `note`. Throws `AppError(404)` if not found.

### `assignTask(taskId, slotId)`

```ts
assignTask(taskId: string, slotId: string): Promise<ScheduleSlot>
```

Atomically links a task to a slot: sets `slot.taskId`, `slot.type = 'task'`, `slot.status = 'pending'`; sets `task.slotId` and `task.status = 'assigned'`. Throws `AppError(400)` if the task is `done` or `cancelled`.

### `unassignTask(slotId)`

```ts
unassignTask(slotId: string): Promise<ScheduleSlot>
```

Atomically removes a task from a slot: clears `slot.taskId`, resets `slot.status = 'pending'` (type and goalId are preserved); clears `task.slotId` and resets `task.status = 'pending'`. Throws `AppError(400)` if the slot has no assigned task.

---

## Board Service

### `getBoard()`

```ts
getBoard(): Promise<{ goals: GoalWithHierarchy[], stats, weekSummary | null }>
```

Returns the full board state:
- All goals sorted by focus order, each with nested initiatives and their tasks.
- `stats`: aggregate task counts (`total`, `pending`, `assigned`, `inProgress`, `done`, `blocked`, `cancelled`). Cancelled tasks are excluded from `total`.
- `weekSummary`: current week plan with slot counts, or `null` if no plan for this week.

---

## Agents Service

Manages the agents Intella owns. The `agents` DB table is the source of truth — **Intella only tracks agents it created**, never external openclaw agents that live on the user's machine. Writes are write-through: every create/update/delete mutates both the `openclaw` CLI (via `child_process.execFile`) **and** the DB row. [`repairAgents`](#repairagents) is the recovery path when tracked openclaw agents go missing from the CLI.

### `listAgents()`

```ts
listAgents(): Promise<OpenclawAgent[]>
```

Returns all agent rows from the DB, ordered by `created_at` ascending. Does **not** shell out to the CLI — external openclaw agents are never returned.

### `getAgent(id)`

```ts
getAgent(id: string): Promise<OpenclawAgent>
```

Returns a single row from the DB. Throws `notFound('Agent', id)` if no row exists. Does not shell out to the CLI.

### `createAgent(input)`

```ts
createAgent(input: { name, model, systemPrompt? }): Promise<OpenclawAgent>
```

1. Normalizes `name` → lowercase, alphanumeric + hyphens (used as agent id and folder name). Throws `AppError(400)` if the result is empty.
2. Throws `AppError(409)` if a row with that id already exists in the DB.
3. Creates `~/.openclaw/agents/<id>/workspace` (recursive).
4. If `systemPrompt` is provided, writes it to `<workspace>/SOUL.md`.
5. Runs `openclaw agents add <id> --workspace <dir> --model <input.model> --non-interactive --json`.
6. Reads the authoritative agent record back from the CLI (picks up identity fields like `identityName`/`identityEmoji`) and inserts a row into `agents` with `isDefault: false`. The `isDefault` flag is owned by Intella and never inherited from openclaw — the default agent's row is seeded manually (currently the `intella` row).

### `updateAgent(id, input)`

```ts
updateAgent(id: string, input: { systemPrompt?: string | null }): Promise<OpenclawAgent>
```

Editable fields are intentionally narrow:
- **`systemPrompt`** — rewrites `<workspace>/SOUL.md` and mirrors the value into the DB row. Passing `null` or an empty/whitespace-only string removes `SOUL.md` and sets the DB column to `null`.

`name` and `model` are not editable — delete and recreate to change them. Throws `notFound('Agent', id)` if the row is missing.

### `deleteAgent(id)`

```ts
deleteAgent(id: string): Promise<void>
```

Validates the agent exists in the DB (`AppError(404)` otherwise) and is not the default (`AppError(400)` if `is_default` is true). Runs `openclaw agents delete <id> --force --json`, best-effort removes `~/.openclaw/agents/<id>`, then deletes the DB row.

### `repairAgents()`

```ts
repairAgents(): Promise<OpenclawAgent[]>
```

Recovery path for when a tracked openclaw agent has gone missing from the CLI (e.g. the user deleted it directly via `openclaw agents delete`). For every DB row whose id is not present in `openclaw agents list`, re-creates the openclaw agent with that row's workspace, model, and `SOUL.md`.

**Does not import external openclaw agents** — rows that exist only in the CLI are ignored, and DB rows are never deleted by this function. Returns the full DB snapshot ordered by `created_at`. Exposed via `POST /api/agents/repair`.

---

## Chat Service

Entry point for user-initiated chat turns. Resolves (or creates) a `chat_sessions` row, persists the user message, starts an `agent_invocations` row, proxies the turn through the `openclaw` CLI, then records the assistant message and completes (or fails) the invocation. Phase 2 replaces the subprocess with an in-process Anthropic SDK loop.

### `sendMessage(req)`

```ts
sendMessage(req: {
  message: string;
  agentId?: string;
  context?: { type: string; id?: string; name?: string; emoji?: string; section?: string; date?: string };
  sessionId?: string;
}): Promise<{ reply: string; sessionId: string; agentId: string; invocationId: string }>
```

1. Resolves the agent id (`req.agentId` or the `intella` default).
2. Builds a context header (matches the previous stringly-typed prompt).
3. Resolves the session: if `sessionId` is provided and exists, reuses it; otherwise `findOrCreateSession` by `(agentId, context.type, context.id)`.
4. Appends the user message via `appendMessage`.
5. Starts an invocation with `trigger='user_chat'` and `model = AGENT_DEFAULT_MODEL` (env, defaults to `claude-opus-4-6`).
6. Runs `openclaw agent --agent <id> --session-id <legacy-key> --message <prompt> --json --timeout 120`.
7. On success: appends the assistant message linked to the invocation and calls `completeInvocation` with `tokensIn: 0 / tokensOut: 0` (Phase 2 populates real counts).
8. On failure: calls `failInvocation` with the error message and rethrows a wrapped error.

The legacy `intella-ios-<agent>-<ctx>-<id>` key is still passed to openclaw so existing on-disk sessions aren't orphaned while Phase 2 is pending.

---

## Conversations Service

CRUD over `chat_sessions` and `chat_messages`. The DB is the source of truth for transcripts — the iOS client, the brief generator, and the debugging UI all read from here.

### `createSession(input)`

```ts
createSession(input: {
  agentId: string;
  contextType?: string | null;
  contextId?: string | null;
  title?: string | null;
}): Promise<ChatSession>
```

Inserts a new session. `createdAt` and `lastMessageAt` are both set to `now()`.

### `findOrCreateSession(input)`

```ts
findOrCreateSession(input: {
  agentId: string;
  contextType: string | null;
  contextId: string | null;
}): Promise<ChatSession>
```

Returns the most recent session matching the `(agentId, contextType, contextId)` tuple (null matches null in the DB), or creates one. Used by the chat service to dedup sessions per view.

### `getSession(id)`

Returns a single row. Throws `notFound('ChatSession', id)` if missing.

### `listSessions(opts)`

```ts
listSessions(opts: {
  agentId?: string;
  contextType?: string;
  contextId?: string;
  limit?: number;
}): Promise<ChatSession[]>
```

Sessions ordered by `lastMessageAt` desc. Default limit 50, max 200 (enforced at the route layer).

### `deleteSession(id)`

Hard delete in a synchronous transaction: removes all tool-call rows for the session's messages, then the messages, then the session. Throws `notFound` if missing.

### `appendMessage(input)`

```ts
appendMessage(input: {
  sessionId: string;
  invocationId?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
}): Promise<ChatMessage>
```

Auto-increments `sortOrder` (computed from `MAX(sort_order) + 1`), updates the parent session's `lastMessageAt`, and — if this is the first user message on a session without a title — derives the title as the first 80 characters of `content`. Wraps the insert and session update in a transaction. Throws `notFound` if the session doesn't exist.

### `listMessages(sessionId, opts)`

```ts
listMessages(sessionId: string, opts?: { limit?: number; before?: string }): Promise<ChatMessage[]>
```

Returns messages in `sortOrder` ascending. `before` is a message id used for reverse-chronological pagination (returns messages with a lower `sortOrder` than the anchor). Default limit 100, max 500.

### `getMessageCount(sessionId)`

Cheap count helper used by `GET /api/chat/sessions/:id`.

---

## Invocations Service

Manages the lifecycle of `agent_invocations` rows. Every agent run — chat turns, scheduled slot starts, brief generation, manual debug runs — flows through this service.

### `startInvocation(input)`

```ts
startInvocation(input: {
  trigger: 'slot_start' | 'brief' | 'user_chat' | 'manual';
  triggerRefId?: string | null;
  agentId: string;
  sessionId: string;
  model: string;
}): Promise<AgentInvocation>
```

Inserts a row with `status='running'`, `startedAt = now()`, `tokensIn = 0`, `tokensOut = 0`.

### `completeInvocation(id, input)`

```ts
completeInvocation(id: string, input: { tokensIn: number; tokensOut: number }): Promise<AgentInvocation>
```

Sets `status='complete'`, `endedAt = now()`, and records final token counts. Throws `notFound` if the invocation doesn't exist.

### `failInvocation(id, input)`

```ts
failInvocation(id: string, input: {
  error: string;
  status?: 'error' | 'timeout' | 'cancelled';
  tokensIn?: number;
  tokensOut?: number;
}): Promise<AgentInvocation>
```

Sets `status` (default `error`), `endedAt`, and `error`. Token counts are optional (partial-run bookkeeping).

### `listInvocations(opts)`

```ts
listInvocations(opts?: {
  limit?: number;
  trigger?: InvocationTrigger;
  status?: InvocationStatus;
  since?: string;
}): Promise<AgentInvocation[]>
```

Ordered by `startedAt` desc. Default limit 50, max 200.

### `getInvocation(id)`

```ts
getInvocation(id: string): Promise<{
  invocation: AgentInvocation;
  messages: ChatMessage[];
  toolCalls: ToolCallLog[];
}>
```

Full detail for the debugging UI: the invocation row plus every message and tool call that references it. Throws `notFound` if missing.

### `getTodayTokenUsage()`

Sums `tokensIn + tokensOut` across all invocations started since the current UTC day boundary. Used by the Phase 2 runner to enforce `AGENT_DAILY_TOKEN_CAP`.

---

## Tool Calls Service

Records Anthropic-format tool calls as they start and resolve. Populated by the Phase 2 runner; stubs exist in Phase 1 so downstream code can be wired up before the runner lands.

### `recordToolCallStart(input)`

```ts
recordToolCallStart(input: {
  id: string;               // Anthropic tool_use_id
  messageId: string;        // assistant message that issued the tool_use block
  invocationId: string;
  toolName: string;
  input: unknown;
}): Promise<ToolCallLog>
```

Inserts a row with `startedAt = now()`, `output = null`, `isError = false`. JSON-encodes `input`.

### `recordToolCallResult(id, input)`

```ts
recordToolCallResult(id: string, input: {
  output: unknown;
  isError: boolean;
  durationMs: number;
}): Promise<ToolCallLog>
```

Sets `output` (JSON-encoded), `isError`, `endedAt = now()`, and `durationMs`. Throws `notFound` if the tool-call row doesn't exist.
