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
- [Requirements Service](#requirements-service)
  - [`addRequirement`](#addrequirementtaskid-description)
  - [`updateRequirement`](#updaterequirementreqid-patch)
  - [`checkRequirement`](#checkrequirementreqid-completed)
  - [`deleteRequirement`](#deleterequirementreqid)
  - [`addRequirementTest`](#addrequirementtestreqid-description)
  - [`updateRequirementTest`](#updaterequirementtestreqid-testid-patch)
  - [`passRequirementTest`](#passrequirementtestreqid-testid)
  - [`unpassRequirementTest`](#unpassrequirementtestreqid-testid)
  - [`deleteRequirementTest`](#deleterequirementtestreqid-testid)
- [Agent Assignments Service](#agent-assignments-service)
  - [`listAgentAssignmentsForTask`](#listagentassignmentsfortasktaskid)
  - [`getAgentAssignment`](#getagentassignmentid)
  - [`createAgentAssignment`](#createagentassignmenttaskid-input)
  - [`updateAgentAssignment`](#updateagentassignmentid-input)
  - [`completeAgentAssignment`](#completeagentassignmentid)
  - [`deleteAgentAssignment`](#deleteagentassignmentid)
- [Schedule Service](#schedule-service)
  - [`getTodaySlots`](#gettodayslots)
  - [`getWeekSlots`](#getweekslotsweestart)
  - [`generateWeekPlan`](#generateweekplanweestart)
  - [`updateSlot`](#updateslotid-input)
  - [`doneSlot`](#doneslotid-input)
  - [`skipSlot`](#skipslotid-input)
  - [`assignAgentAssignment`](#assignagentassignmentaaid-slotid)
  - [`unassignAgentAssignment`](#unassignagentassignmentslotid)
  - [`addSlotOutput`](#addslotoutputslotid-input)
  - [`deleteSlotOutput`](#deleteslotoutputslotid-outputid)
- [Board Service](#board-service)
  - [`getBoard`](#getboard)
- [Agents Service](#agents-service)
  - [`listAgents`](#listagents)
  - [`getAgent`](#getagentid)
  - [`createAgent`](#createagentinput)
  - [`updateAgent`](#updateagentid-input)
  - [`deleteAgent`](#deleteagentid)
  - [`repairAgents`](#repairagents)
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
  - [`setInvocationRunId`](#setinvocationrunidid-gatewayrunid)
  - [`completeInvocation`](#completeinvocationid-input)
  - [`failInvocation`](#failinvocationid-input)
  - [`listInvocations`](#listinvocationsopts)
  - [`getInvocation`](#getinvocationid)
  - [`getTodayTokenUsage`](#gettodaytokenusage)
- [Tool Calls Service](#tool-calls-service)
  - [`recordToolCallStart`](#recordtoolcallstartinput)
  - [`recordToolCallResult`](#recordtoolcallresultid-input)
  - [`backfillToolCallMessageIds`](#backfilltoolcallmessageidsinvocationid-messageid)
- [Profile Service](#profile-service)
  - [`getProfile`](#getprofile)
  - [`getSection`](#getsectionsectionid)
  - [`updateSection`](#updatesectionsectionid-input)
  - [`addEntry`](#addentrysectionid-input)
  - [`updateEntry`](#updateentryentryid-input)
  - [`deleteEntry`](#deleteentryentryid)
- [Context Groups Service](#context-groups-service)
  - [`listPinnedContexts`](#listpinnedcontexts)
  - [`createPinnedContext`](#createpinnedcontextinput)
  - [`deletePinnedContext`](#deletepinnedcontextid)
  - [`listContextGroups`](#listcontextgroups)
  - [`getContextGroup`](#getcontextgroupid)
  - [`createContextGroup`](#createcontextgroupinput)
  - [`updateContextGroup`](#updatecontextgroupid-input)
  - [`deleteContextGroup`](#deletecontextgroupid)
  - [`addContextGroupMember`](#addcontextgroupmembergroupid-input)
  - [`removeContextGroupMember`](#removecontextgroupmembergroupid-memberid)
- [Briefs Service](#briefs-service)
  - [`listBriefs`](#listbriefsopts)
  - [`getBrief`](#getbriefid)
  - [`getBriefsByDate`](#getbriefsbydatedate)
  - [`generateBrief`](#generatebriefinput)
  - [`updateBrief`](#updatebriefid-input)
  - [`deleteBrief`](#deletebriefid)
  - [`upsertStubBrief`](#upsertstubbriefdate-kind)

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

Sets the initiative's `status` to `completed` and bulk-cancels all tasks still in `pending`, `in-progress`, or `blocked`. Both updates share the same timestamp.

### `deleteInitiative(id)`

```ts
deleteInitiative(id: string): Promise<void>
```

Hard-delete in a synchronous transaction: deletes all tasks under the initiative first, then deletes the initiative. Throws `AppError(404)` if not found.

---

## Tasks Service

Manages pure task records. Tests live under requirements (see [Requirements Service](#requirements-service)); agent-delegated work and outputs live on agent assignments and slots respectively.

### `listTasks(opts)`

```ts
listTasks(opts: {
  initiativeId?: string;
  status?: string | string[];
}): Promise<Task[]>
```

Returns tasks filtered by `initiativeId` and/or one or more `status` values, sorted by `sortOrder`.

### `getTask(id)`

```ts
getTask(id: string): Promise<TaskDetail>
```

Returns full task detail: task row + `requirements` (each with nested `tests`), `agentAssignments`, parent `initiative` (or `null`), and the grandparent `goal` (or `null`). Throws `AppError(404)` if not found.

### `createTask(input)`

```ts
createTask(input: CreateTaskInput): Promise<TaskDetail>
```

Inserts the task and any starter requirements in a single synchronous transaction. Returns full task detail via `loadTaskDetail`.

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

Hard-deletes the task row. Requirements, requirement tests, and agent assignments are removed by `ON DELETE CASCADE` at the DB level. Throws `AppError(404)` if not found.

---

## Requirements Service

Manages `task_requirements` and their nested `requirement_tests`. Requirement IDs are global — operations are addressed by `reqId` directly (no task-scoping).

### `addRequirement(taskId, description)`

Appends a new unchecked requirement to the given task. `sortOrder` is set to the current count of existing requirements. Throws `AppError(404)` if the task doesn't exist.

### `updateRequirement(reqId, patch)`

Updates `description` and/or `completed`. Throws `AppError(400)` if the patch is empty; `AppError(404)` if the requirement doesn't exist.

### `checkRequirement(reqId, completed)`

Convenience wrapper that sets only the `completed` boolean.

### `deleteRequirement(reqId)`

Removes the requirement. Child `requirement_tests` cascade at the DB level.

### `addRequirementTest(reqId, description)`

Appends a new unpassed test under the given requirement. `sortOrder` is set to the current count.

### `updateRequirementTest(reqId, testId, patch)`

Updates `description` and/or `passed`. Validates both ids match.

### `passRequirementTest(reqId, testId)`

Convenience: sets `passed = true`.

### `unpassRequirementTest(reqId, testId)`

Convenience: sets `passed = false`.

### `deleteRequirementTest(reqId, testId)`

Removes the test. Validates both ids match.

---

## Agent Assignments Service

Manages `agent_assignments` — discrete chunks of task work delegated to an agent. Scheduling operates on agent assignments, not tasks.

### `listAgentAssignmentsForTask(taskId)`

```ts
listAgentAssignmentsForTask(taskId: string): Promise<(AgentAssignment & { slots: ScheduleSlot[] })[]>
```

Returns all assignments under a task, sorted by `sortOrder`. Each assignment is enriched with the schedule slots currently referencing it (bulk-loaded via `inArray(scheduleSlots.agentAssignmentId, ids)` — no N+1).

### `getAgentAssignment(id)`

```ts
getAgentAssignment(id: string): Promise<AgentAssignment & { slots: ScheduleSlot[] }>
```

Single-row variant of the above. Throws `AppError(404)` if not found.

### `createAgentAssignment(taskId, input)`

```ts
createAgentAssignment(taskId: string, input: CreateAgentAssignmentInput): Promise<AgentAssignment>
```

Inserts a new assignment with `completed: false`, `sortOrder = current count`, and optional `agentId` / `instructions`. Throws `AppError(404)` if the task doesn't exist.

### `updateAgentAssignment(id, input)`

```ts
updateAgentAssignment(id: string, input: UpdateAgentAssignmentInput): Promise<AgentAssignment>
```

Updates `name`, `agentId`, `instructions`, and/or `sortOrder`. Passing `agentId: null` or `instructions: null` clears those fields.

### `completeAgentAssignment(id)`

```ts
completeAgentAssignment(id: string): Promise<AgentAssignment>
```

Sets `completed = true` and stamps `completedAt = now()`. Idempotent.

### `deleteAgentAssignment(id)`

```ts
deleteAgentAssignment(id: string): Promise<void>
```

Hard-deletes the assignment in a transaction: any schedule slots referencing it are first reset to `type = 'flex'`, `agentAssignmentId = null`, `status = 'pending'`, then the row is removed.

---

## Schedule Service

Manages week plan generation, slot queries, and slot lifecycle.

### `getTodaySlots()`

```ts
getTodaySlots(): Promise<SlotWithAssignment[]>
```

Returns all slots for today's date (derived at call time). Enriches each slot with the linked `agentAssignment` (+ parent `task`, `initiative`, `goal`) and its `outputs`. Returns empty array if no week plan exists for the current week.

### `getWeekSlots(weekStart)`

```ts
getWeekSlots(weekStart: string): Promise<{ weekPlan, slots: SlotWithAssignment[], allocations }>
```

Returns the full week plan, all slots with agent-assignment + output enrichment, and per-goal allocations. Normalizes `weekStart` to the Sunday of that date. If no plan exists, returns `{ weekPlan: null, slots: [], allocations: [] }` — no generation is triggered.

### `getSlotsInRange(from, to)`

```ts
getSlotsInRange(from: string, to: string): Promise<{ from, to, slots: SlotWithAssignment[] }>
```

Returns all slots whose `date` is within the inclusive `[from, to]` range, ordered by `datetime`, with agent-assignment enrichment applied. Throws `AppError(400)` if `from > to`. Unlike `getWeekSlots`, this query is not keyed to a `weekPlans` row — it spans plan boundaries, so it's safe to call for arbitrary ranges (e.g., month grid, year overview).

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
6. Distributes agent-assignment-eligible flex slots to goals in allocation order, upgrading them to type `agent_assignment`.
7. Looks up open agent assignments under each goal (via task → initiative → goal), and links each to one of that goal's assignment slots via `agentAssignmentId`.
8. Persists `weekPlan`, `scheduleSlots`, and `weekGoalAllocations` in one transaction. Tasks are not mutated — scheduling flows exclusively through agent assignments now.

### `updateSlot(id, input)`

```ts
updateSlot(id: string, input: UpdateSlotInput): Promise<ScheduleSlot>
```

Generic patch: updates `status`, `agentAssignmentId`, and/or `note`. Throws `AppError(404)` if slot not found.

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

### `assignAgentAssignment(aaId, slotId)`

```ts
assignAgentAssignment(aaId: string, slotId: string): Promise<ScheduleSlot>
```

Atomically links an agent assignment to a slot: sets `slot.agentAssignmentId`, `slot.type = 'agent_assignment'`, `slot.status = 'pending'`. Tasks are not modified. Throws `AppError(400)` if the assignment is already completed.

### `unassignAgentAssignment(slotId)`

```ts
unassignAgentAssignment(slotId: string): Promise<ScheduleSlot>
```

Atomically removes the agent assignment from a slot: clears `slot.agentAssignmentId`, resets `slot.type = 'flex'`, `slot.status = 'pending'` (goalId is preserved). Throws `AppError(400)` if the slot has no assigned agent assignment.

### `addSlotOutput(slotId, input)`

```ts
addSlotOutput(slotId: string, input: AddSlotOutputInput): Promise<SlotOutput>
```

Inserts an output artifact (`{ label, url? }`) linked to the slot. Throws `AppError(404)` if the slot doesn't exist.

### `deleteSlotOutput(slotId, outputId)`

```ts
deleteSlotOutput(slotId: string, outputId: string): Promise<void>
```

Removes the output. Validates both ids match.

---

## Board Service

### `getBoard()`

```ts
getBoard(): Promise<{ goals: GoalWithHierarchy[], stats, weekSummary | null }>
```

Returns the full board state:
- All goals sorted by focus order, each with nested initiatives and their tasks.
- `stats`: aggregate task counts (`total`, `pending`, `inProgress`, `done`, `blocked`, `cancelled`). Cancelled tasks are excluded from `total`.
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

Returns the most recent session matching the `(agentId, contextType, contextId)` tuple (null matches null in the DB), or creates one. Used by the chat orchestrator to dedup sessions per view.

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
  gatewayRunId?: string | null;
}): Promise<AgentInvocation>
```

Inserts a row with `status='running'`, `startedAt = now()`, `tokensIn = 0`, `tokensOut = 0`. `gatewayRunId` is typically left unset here — the runner populates it via `setInvocationRunId` once the `agent` RPC returns.

### `setInvocationRunId(id, gatewayRunId)`

```ts
setInvocationRunId(id: string, gatewayRunId: string): Promise<void>
```

Attaches the OpenClaw gateway `runId` to an already-started invocation. Called by the Phase 2 runner immediately after the `agent` RPC resolves, so `/api/invocations/:id` readers can correlate with gateway logs mid-turn.

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

Records Anthropic-format tool calls as they start and resolve. Populated by the Phase 2 runner from the gateway's tool-stream events.

### `recordToolCallStart(input)`

```ts
recordToolCallStart(input: {
  id: string;                      // Anthropic tool_use_id
  messageId: string | null;        // assistant message; may be null if tool.start precedes the block's text
  invocationId: string;
  toolName: string;
  input: unknown;
}): Promise<ToolCallLog>
```

Inserts a row with `startedAt = now()`, `output = null`, `isError = false`, `summary = null`. JSON-encodes `input`. `messageId` is nullable because the gateway can emit `tool.start` before any assistant text for the block — the runner backfills on `message_complete` via `backfillToolCallMessageIds`.

### `recordToolCallResult(id, input)`

```ts
recordToolCallResult(id: string, input: {
  output: unknown;
  isError: boolean;
  durationMs: number;
  summary?: string | null;
}): Promise<ToolCallLog>
```

Sets `output` (JSON-encoded), `isError`, `endedAt = now()`, `durationMs`, and the optional presenter-computed `summary`. Throws `notFound` if the tool-call row doesn't exist.

### `backfillToolCallMessageIds(invocationId, messageId)`

```ts
backfillToolCallMessageIds(invocationId: string, messageId: string): Promise<void>
```

Attaches `messageId` to every tool_call_log row for `invocationId` whose `messageId` is still null. The runner calls this on every `message_complete` to resolve the plan §6.7 edge case where `tool.start` arrives before the assistant block's text.

---

## Profile Service

Manages the user's long-running profile (structured sections + entries). Sections are static and seeded at install; entries are fully CRUD. See [profile.service.ts](profile.service.ts).

### `getProfile()`

```ts
getProfile(): Promise<{ sections: (ProfileSection & { entries: ProfileEntry[] })[] }>
```

Returns every section ordered by `sortOrder`, each with its entries sorted by `sortOrder` then `createdAt`.

### `getSection(sectionId)`

```ts
getSection(sectionId: string): Promise<ProfileSection & { entries: ProfileEntry[] }>
```

Returns one section with its entries. Throws `AppError(404)` if the section id is unknown.

### `updateSection(sectionId, input)`

```ts
updateSection(sectionId: string, input: UpdateProfileSectionInput): Promise<ProfileSection>
```

Updates `summary` (null clears) and/or `sortOrder`. Stamps `updatedAt`.

### `addEntry(sectionId, input)`

```ts
addEntry(sectionId: string, input: AddProfileEntryInput): Promise<ProfileEntry>
```

Inserts an entry under the section. Defaults `confidence` to `observed` and `sortOrder` to 0. Bumps the section's `updatedAt`. Throws `AppError(404)` if the section id is unknown.

### `updateEntry(entryId, input)`

```ts
updateEntry(entryId: string, input: UpdateProfileEntryInput): Promise<ProfileEntry>
```

Partial update. Nullable fields (`detail`, `source`) accept `null` to clear. Bumps both the entry's and its parent section's `updatedAt`.

### `deleteEntry(entryId)`

Hard-deletes the entry and bumps the parent section's `updatedAt`.

---

## Context Groups Service

Persists the floating chat's pinned contexts and context groups. Each stored row snapshots the display label/icon at save time so the UI renders without resolving the ref. See [contextGroups.service.ts](contextGroups.service.ts).

### `listPinnedContexts()`

```ts
listPinnedContexts(): Promise<PinnedContext[]>
```

Flat list sorted by `sortOrder` then `createdAt`.

### `createPinnedContext(input)`

Inserts a `pinned_contexts` row. No dedup — the client is responsible for ensuring a matching ref isn't already pinned.

### `deletePinnedContext(id)`

Hard delete. Throws `AppError(404)` if the id is unknown.

### `listContextGroups()`

```ts
listContextGroups(): Promise<(ContextGroup & { members: ContextGroupMember[] })[]>
```

Returns every group with its members, both sorted by `sortOrder`.

### `getContextGroup(id)`

Single group with members. Throws `AppError(404)` if not found.

### `createContextGroup(input)`

Inserts the group plus any initial `members[]` in a single transaction. Each member gets a fresh `id`; missing `sortOrder` defaults to the member's index in the array.

### `updateContextGroup(id, input)`

Partial update of `name`, `icon`, `summary` (null clears), `sortOrder`. Stamps `updatedAt`.

### `deleteContextGroup(id)`

Transactional hard delete: members first, then the group.

### `addContextGroupMember(groupId, input)`

Inserts a member under the group and bumps the group's `updatedAt`. Throws `AppError(404)` if the group id is unknown.

### `removeContextGroupMember(groupId, memberId)`

Deletes the member, bumping the group's `updatedAt`. Throws `AppError(404)` if the member id is unknown or doesn't belong to the given group.

---

## Briefs Service

Reads and writes morning/afternoon/evening briefings. Generation itself is delegated to the agent runner (Track C); until it ships, `generateBrief` returns `AppError(501)` and briefs can still be authored manually via `updateBrief`. See [briefs.service.ts](briefs.service.ts).

### `listBriefs(opts)`

```ts
listBriefs(opts: { from: string; to: string }): Promise<Brief[]>
```

Returns briefs within the inclusive `[from, to]` date range. Ordered by `date desc`, then `kind` in canonical order (morning, afternoon, evening). Throws `AppError(400)` if `from > to`.

### `getBrief(id)`

Single row. Throws `AppError(404)` if not found.

### `getBriefsByDate(date)`

```ts
getBriefsByDate(date: string): Promise<{
  date: string;
  morning: Brief | null;
  afternoon: Brief | null;
  evening: Brief | null;
}>
```

Always returns all three slots, filling missing ones with `null`.

### `generateBrief(input)`

Throws `AppError(501)` until the agent runner is wired up. Signature takes `{ date, kind }` and will return `{ briefId, invocationId }` once Track C lands.

### `updateBrief(id, input)`

Partial update of `title`, `body`, `references` (each accepts `null` to clear) and `status`. Stamps `updatedAt`.

### `deleteBrief(id)`

Hard delete. Throws `AppError(404)` if the id is unknown.

### `upsertStubBrief(date, kind)`

Internal helper for Track C: returns the existing `(date, kind)` row if one exists, otherwise inserts a `pending` stub so the runner has a row to update as it streams output. Not exposed via the REST API.
