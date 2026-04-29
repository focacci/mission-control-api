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
  - [`doneTask`](#donetaskid-input)
  - [`reopenTask`](#reopentaskid)
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
  - [`listAgentAssignmentsForParent`](#listagentassignmentsforparentkind-parentid)
  - [`listAllAgentAssignments`](#listallagentassignments)
  - [`getAgentAssignment`](#getagentassignmentid)
  - [`createAgentAssignmentForParent`](#createagentassignmentforparentkind-parentid-input)
  - [`resolveGoalIdsForAssignments`](#resolvegoalidsforassignmentsaaids)
  - [`updateAgentAssignment`](#updateagentassignmentid-input)
  - [`startAgentAssignment`](#startagentassignmentid)
  - [`forceInProgress`](#forceinprogressid)
  - [`completeAgentAssignment`](#completeagentassignmentid)
  - [`blockAgentAssignment`](#blockagentassignmentid)
  - [`reopenAgentAssignment`](#reopenagentassignmentid)
  - [`unassignAgentAssignment`](#unassignagentassignmentid)
  - [`deleteAgentAssignment`](#deleteagentassignmentid)
- [Agent Outputs Service](#agent-outputs-service)
  - [`createAgentOutput`](#createagentoutputagentassignmentid-input)
  - [`appendAgentOutputStep`](#appendagentoutputstepoutputid-input)
  - [`completeAgentOutput`](#completeagentoutputoutputid-input)
  - [`failAgentOutput`](#failagentoutputoutputid-input)
  - [`listAgentOutputsForAssignment`](#listagentoutputsforassignmentagentassignmentid)
  - [`listAllAgentOutputs`](#listallagentoutputs)
  - [`getAgentOutput`](#getagentoutputoutputid)
  - [`deleteAgentOutput`](#deleteagentoutputoutputid)
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
  - [`suggestSlotsForAssignment`](#suggestslotsforassignmentaaid-weestart-limit)
  - [`findDueSlots`](#finddueslotsnowlocaldatetime)
  - [`claimSlotForRun`](#claimslotforrunslotid)
- [Slot Runner](#slot-runner)
  - [`runDueSlot`](#rundueslotslot)
  - [`startSlotTicker`](#startslottickeropts)
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
  - [`pinSessionContext`](#pinsessioncontextid-contexttype-contextid)
  - [`listSessions`](#listsessionsopts-1)
  - [`deleteSession`](#deletesessionid)
  - [`appendMessage`](#appendmessageinput)
  - [`listMessages`](#listmessagessessionid-opts)
  - [`getMessageCount`](#getmessagecountsessionid)
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
  - [`cancelInvocation`](#cancelinvocationid-opts)
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
  - [`computeBriefWindow`](#computebriefwindowdate-kind)
  - [`findBriefForInstant`](#findbriefforinstantinstant)
  - [`appendBriefEvidence`](#appendbriefevidencebriefid-item)
  - [`appendEvidenceForInstant`](#appendevidenceforinstantoccurredat-item)
  - [`finalizeBrief`](#finalizebriefbriefid)
  - [`maybeLazyFinalize`](#maybelazyfinalizebriefid-asof)
  - [`acknowledgeBrief`](#acknowledgebriefbriefid)
- [Pending Parts Service](#pending-parts-service)
  - [`getActiveInvocationId`](#getactiveinvocationidsessionid)
  - [`enqueuePart`](#enqueuepartsessionid-part)
  - [`drainParts`](#drainpartsinvocationid)
- [Attachments Service](#attachments-service)
  - [`saveAttachment`](#saveattachmentinput)
- [Cards Service](#cards-service)
  - [`hydrateCards`](#hydratecardsrefs)

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

### `doneTask(id, input)`

```ts
doneTask(id: string, input: DoneTaskInput): Promise<TaskDetail>
```

- Validates that all requirements are checked. Returns `AppError(400)` with `details.incomplete` if any are unchecked.
- Sets `status = done`, records `summary` and `completedAt`.

### `reopenTask(id)`

```ts
reopenTask(id: string): Promise<TaskDetail>
```

Sets `status = pending` and clears `completedAt`. Idempotent.

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

Manages `agent_assignments` — discrete chunks of work delegated to an agent. Each assignment is parented to **exactly one** of a goal, initiative, or task (the other two id columns are `null`). Scheduling operates on agent assignments, not the parent itself.

### `listAgentAssignmentsForParent(kind, parentId)`

```ts
listAgentAssignmentsForParent(
  kind: 'goal' | 'initiative' | 'task',
  parentId: string,
): Promise<(AgentAssignment & { slots: ScheduleSlot[] })[]>
```

Returns all assignments under a given parent, sorted by `sortOrder`. Each assignment is enriched with the schedule slots currently referencing it (bulk-loaded via `inArray(scheduleSlots.agentAssignmentId, ids)` — no N+1). Throws `AppError(404)` if the parent doesn't exist.

`listAgentAssignmentsForTask`, `listAgentAssignmentsForGoal`, and `listAgentAssignmentsForInitiative` are thin wrappers that pass the right `kind`.

### `listAllAgentAssignments()`

```ts
listAllAgentAssignments(): Promise<(AgentAssignment & { slots: ScheduleSlot[] })[]>
```

Returns every agent assignment across all parents, sorted newest first by `updatedAt`. Each row is enriched with its scheduled slots using the same bulk slot lookup as `listAgentAssignmentsForParent`.

### `getAgentAssignment(id)`

```ts
getAgentAssignment(id: string): Promise<AgentAssignment & { slots: ScheduleSlot[] }>
```

Single-row variant. Throws `AppError(404)` if not found.

### `createAgentAssignmentForParent(kind, parentId, input)`

```ts
createAgentAssignmentForParent(
  kind: 'goal' | 'initiative' | 'task',
  parentId: string,
  input: CreateAgentAssignmentInput,
): Promise<AgentAssignment>
```

Inserts a new assignment, populating only the matching parent column (`goalId` / `initiativeId` / `taskId`) and leaving the other two `null`. Sets `status: 'pending'`, `sortOrder = current count`, and optional `agentId`. Throws `AppError(404)` if the parent doesn't exist. `createAgentAssignment(taskId, input)` is the legacy task-only wrapper.

### `resolveGoalIdsForAssignments(aaIds)`

```ts
resolveGoalIdsForAssignments(aaIds: string[]): Promise<Map<string, string>>
```

For each agent assignment id, resolves the goal it belongs to by walking the parent chain: a direct `goalId` wins; otherwise `initiativeId.goalId`; otherwise `taskId.initiativeId.goalId`. Used by the scheduler when allocating goal slots.

### `updateAgentAssignment(id, input)`

```ts
updateAgentAssignment(id: string, input: UpdateAgentAssignmentInput): Promise<AgentAssignment>
```

Updates `title`, `agentId`, `description`, and/or `sortOrder`. Passing `agentId: null` or `description: null` clears those fields.

### `startAgentAssignment(id)`

```ts
startAgentAssignment(id: string): Promise<AgentAssignment>
```

Starts an assignment. Behavior depends on current status:

- `pending` → `scheduled`: finds the earliest pending, unassigned slot of type `flex` or `agent_assignment` whose `datetime` is strictly after now in `APP_TZ` — goal allocation on the slot is ignored. Links it via `agentAssignmentId`, marks the slot `agent_assignment`, and sets the assignment status to `scheduled`. Throws `AppError(409)` if no slot is available.
- `scheduled` → `in-progress`: begins work on the assignment.
- `blocked` → `in-progress`: resumes a blocked assignment.

Throws `AppError(409)` from any other status.

### `forceInProgress(id)`

```ts
forceInProgress(id: string): Promise<AgentAssignment>
```

Bypasses the slot-allocation path of `startAgentAssignment` and forces an AA from `pending | scheduled | blocked` (or no-op from `in-progress`) to `in-progress`. Used by the slot runner, which already knows which slot is firing the AA. Throws `AppError(409)` if the assignment is `done`.

### `completeAgentAssignment(id)`

```ts
completeAgentAssignment(id: string): Promise<AgentAssignment>
```

Sets `status = done` and stamps `completedAt = now()`. Throws `AppError(409)` if the assignment is not currently `in-progress`.

### `blockAgentAssignment(id)`

```ts
blockAgentAssignment(id: string): Promise<AgentAssignment>
```

Sets `status = blocked`. Throws `AppError(409)` if the assignment is not currently `in-progress`.

### `reopenAgentAssignment(id)`

```ts
reopenAgentAssignment(id: string): Promise<AgentAssignment>
```

Sets `status = pending` and clears `completedAt`. Throws `AppError(409)` if the assignment is not currently `done` or `blocked`.

### `unassignAgentAssignment(id)`

```ts
unassignAgentAssignment(id: string): Promise<AgentAssignment>
```

Clears every schedule slot that references this assignment back to `type = 'flex'`, `agentAssignmentId = null`, `status = 'pending'`, then resets the AA itself to `status = 'pending'` with `completedAt = null`. Works from any state; does not delete the assignment. Used when a user reports a parent task done in real life and the agent wants to clear remaining scheduled work.

### `deleteAgentAssignment(id)`

```ts
deleteAgentAssignment(id: string): Promise<void>
```

Hard-deletes the assignment in a transaction: any schedule slots referencing it are first reset to `type = 'flex'`, `agentAssignmentId = null`, `status = 'pending'`, then the row is removed.

---

## Agent Outputs Service

Defined in [agentOutputs.service.ts](agentOutputs.service.ts). Manages the structured record of one autonomous run of an Agent Assignment — the input, ordered steps (`thinking` / `tool_call` / `text`), and the final response. Independent of `agent_invocations` and `chat_messages`. Currently used by tests and manual callers; the production slot-runner will write through this service when it lands.

### `createAgentOutput(agentAssignmentId, input)`

```ts
createAgentOutput(agentAssignmentId: string, input: CreateAgentOutputInput): Promise<AgentOutput>
```

Opens a new running output for the given assignment. Defaults `agentId` to the assignment's `agentId` when not supplied. Stamps `startedAt = now()` and `status = 'running'`. Throws 404 if the assignment doesn't exist.

### `appendAgentOutputStep(outputId, input)`

```ts
appendAgentOutputStep(outputId: string, input: AppendAgentOutputStepInput): Promise<AgentOutputStep>
```

Appends one ordered step to a running output. Discriminated by `kind`:

- `thinking` — stores `content`.
- `text` — stores `content`.
- `tool_call` — stores `toolName`, `JSON.stringify(toolInput)`, optional `toolOutput`, `isError`, and `durationMs`. Computes `endedAt = startedAt + durationMs` when `durationMs` is provided.

`sortOrder` is auto-assigned as `max(existing) + 1`. Throws 404 if the output is missing, 409 if `output.status !== 'running'`.

### `completeAgentOutput(outputId, input)`

```ts
completeAgentOutput(outputId: string, input: CompleteAgentOutputInput): Promise<AgentOutput>
```

Transitions `running → complete`, writes `response`, `tokensIn`, `tokensOut`, and stamps `endedAt`. Throws 409 if the output is not `running`.

### `failAgentOutput(outputId, input)`

```ts
failAgentOutput(outputId: string, input: FailAgentOutputInput): Promise<AgentOutput>
```

Transitions `running → error` (default) or `running → cancelled`, writes `error`, stamps `endedAt`. Throws 409 if the output is not `running`.

### `listAgentOutputsForAssignment(agentAssignmentId)`

```ts
listAgentOutputsForAssignment(agentAssignmentId: string): Promise<AgentOutput[]>
```

Returns header rows for the assignment ordered by `startedAt` desc. No steps included. Throws 404 if the assignment doesn't exist.

### `listAllAgentOutputs()`

```ts
listAllAgentOutputs(): Promise<AgentOutput[]>
```

Returns header rows for every agent output across all assignments, ordered by `startedAt` desc. No steps included.

### `getAgentOutput(outputId)`

```ts
getAgentOutput(outputId: string): Promise<AgentOutputDetail>
```

Returns `{ output, steps }` with steps ordered by `sortOrder` ascending.

### `deleteAgentOutput(outputId)`

```ts
deleteAgentOutput(outputId: string): Promise<void>
```

Hard-deletes the output row; steps cascade via FK.

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
7. Looks up open agent assignments under each goal — polymorphic AAs are resolved via `resolveGoalIdsForAssignments` (direct `goalId`, then `initiativeId.goalId`, then `taskId.initiativeId.goalId`) — and links each to one of that goal's assignment slots via `agentAssignmentId`.
8. Persists `weekPlan`, `scheduleSlots`, and `weekGoalAllocations` in one transaction. Tasks are not mutated — scheduling flows exclusively through agent assignments now.

### `updateSlot(id, input)`

```ts
updateSlot(id: string, input: UpdateSlotInput): Promise<ScheduleSlot>
```

Generic patch: updates `status`, `agentAssignmentId`, `note`, and/or `extraPrompt`. Throws `AppError(404)` if slot not found.

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

### `suggestSlotsForAssignment(aaId, weekStart?, limit?)`

```ts
suggestSlotsForAssignment(
  agentAssignmentId: string,
  weekStart?: string,
  limit?: number,
): Promise<SlotSuggestion[]>
```

Returns up to `limit` (default 5) ranked slot candidates for placing the given agent assignment in `weekStart`'s plan (defaults to current week). Pure read; no mutation. Throws `AppError(404)` when the AA or the week plan does not exist, and `AppError(400)` when the AA is already `done`.

Eligibility filter: `status = 'pending'`, `agentAssignmentId IS NULL`, `type ∈ {'agent_assignment','flex'}`. Ranking, in order:

1. Goal allocation match (`type = 'agent_assignment'` slot allocated to the AA's resolved goal): +100, reason `"allocated to this goal"`.
2. `agent_assignment` slot allocated to a different goal: +10, reason `"allocated to a different goal"`. (Use sparingly — assigning here re-aims that goal's allocation.)
3. `agent_assignment` slot with no goal: +40.
4. `flex` slot: +50, reason `"open flex slot"`.
5. Proximity: `-2` per day from today; past dates also receive `-200` and the reason is suffixed `(past)`.

Ties break by ascending `datetime`. The AA's parent goal is resolved via [`resolveGoalIdsForAssignments`](#resolvegoalidsforassignmentsaaids), so it works for goal-, initiative-, and task-parented assignments. Pair with [`assignAgentAssignment`](#assignagentassignmentaaid-slotid) once the user picks a candidate.

`SlotSuggestion` shape: `{ slotId, datetime, date, time, type, goalId, score, reason }`.

### `findDueSlots(nowLocalDatetime)`

```ts
findDueSlots(nowLocalDatetime: string): Promise<ScheduleSlot[]>
```

Returns slots whose `datetime <= nowLocalDatetime`, `status = 'pending'`, and `agentAssignmentId IS NOT NULL`, ordered by `datetime ASC`. The argument must be a wall-clock string in `APP_TZ` formatted `YYYY-MM-DDTHH:mm` — comparison against `scheduleSlots.datetime` is lexical, so passing UTC ISO would skew firing by the `APP_TZ` offset. The slot ticker uses `nowLocalDatetime()` from `index.types.ts`.

### `claimSlotForRun(slotId)`

```ts
claimSlotForRun(slotId: string): ScheduleSlot | null
```

Synchronous transactional claim: re-reads the slot inside a transaction, returns `null` if status is no longer `pending`, otherwise sets `status = 'in-progress'` and returns the updated row. Acts as the lock that prevents two ticks (or a tick and a manual update) from double-firing the same slot.

---

## Slot Runner

In-process module that fires due slots and captures each run as an Agent Output. Lives under `src/agent/slotRunner.ts` (one slot at a time) and `src/agent/slotTicker.ts` (60s tick loop).

### `runDueSlot(slot)`

```ts
runDueSlot(slot: ScheduleSlot): Promise<void>
```

Drives a single claimed slot:

1. Loads the slot's `agentAssignmentId` via `getAgentAssignment`. If missing or already `done`, marks the slot `done` and returns.
2. Resolves `agentId = aa.agentId ?? 'intella'` and `model = AGENT_DEFAULT_MODEL ?? 'claude-sonnet-4.6'`.
3. Builds the prompt: `Please complete the following Agent Assignment:\n\n{title}\n\n{description}` plus an optional `\n\n{slot.extraPrompt}` line.
4. Find-or-creates a chat session keyed `(agentId, contextType='slot', contextId=slot.id)`, starts an invocation with `trigger='slot_start'`, opens a `running` Agent Output, and forces the AA to `in-progress`.
5. Awaits `runner.run(...)` with an `onEvent` handler that maps `text_delta` → buffered text, `tool_use` → pending tool, `tool_result` → `appendAgentOutputStep({ kind: 'tool_call' })`, `message_complete` → `appendAgentOutputStep({ kind: 'text' })` flushing the buffer.
6. On resolve: completes the Agent Output with `{ response, tokensIn, tokensOut }`, marks the slot `done`, and completes the AA.
7. On reject: calls `failAgentOutput` with `status='cancelled'` if the captured fatal `error` event used `code='cancelled'`, otherwise `status='error'`. The slot stays `in-progress` and the AA keeps its current status — manual intervention required.

Never throws to its caller. Step writes are serialized through an internal promise queue so they don't interleave with `completeAgentOutput`.

### `startSlotTicker(opts)`

```ts
startSlotTicker(opts?: { intervalMs?: number; logger?: Pick<Console, 'info'|'warn'|'error'> }): () => void
```

Periodic scheduler. Defaults to a 60_000 ms interval (overridable via `SLOT_TICKER_INTERVAL_MS`). Holds an `isRunning` flag to drop re-entry if a tick is still draining. Per tick: queries `findDueSlots(now)`, then for each slot calls `claimSlotForRun(slot.id)` and (on success) `runDueSlot(claimed)` sequentially. Fires one tick immediately on start. Returns a stop function used for tests / SIGTERM / SIGINT shutdown.

---

## Board Service

### `getBoard()`

```ts
getBoard(): Promise<{ goals: GoalWithHierarchy[], stats, weekSummary | null }>
```

Returns the full board state:
- All goals sorted by focus order, each with nested initiatives and their tasks.
- `stats`: aggregate task counts (`total`, `pending`, `done`).
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

### `pinSessionContext(id, contextType, contextId)`

```ts
pinSessionContext(
  id: string,
  contextType: string,
  contextId: string | null,
): Promise<{ pinned: boolean; reason?: string; session: ChatSession }>
```

Idempotently anchors a session: writes `contextType`/`contextId` only if the session has no anchor yet. If `session.contextType` is already set, returns `{ pinned: false, reason: 'already_anchored', session }` without overwriting. Used by the `pin_to_context` MCP tool (Bucket 1 of `Plans/MCP_TOOLKIT_PLAN.md`); single-anchor by design until multi-context lands.

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
  content?: string;
  parts?: MessagePart[];
}): Promise<ChatMessage>
```

Persists a `chat_messages` row plus the structured `parts` payload introduced by MCP_TOOLKIT_PLAN Bucket 2a. Callers may supply `parts` (preferred), `content` (legacy plain text), or both — exactly one must be present. The service normalizes:

- `parts` only → `content` is derived via `partsToText(parts)` for the legacy column.
- `content` only → `parts = [{ kind: 'text', text: content }]`.
- both → trusted as-given and persisted unchanged.

`parts` is validated with the discriminated `MessagePartSchema` before write. Auto-increments `sortOrder` (computed from `MAX(sort_order) + 1`), updates the parent session's `lastMessageAt`, and — if this is the first user message on a session without a title — derives the title as the first 80 characters of the resolved `content`. Wraps the insert and session update in a transaction. Throws `notFound` if the session doesn't exist; throws `AppError(400)` if both `parts` and `content` are absent.

The returned `ChatMessage` always carries a non-null `parts` array (the legacy column is preserved on the row but normalization fills `parts` for new readers).

### `listMessages(sessionId, opts)`

```ts
listMessages(sessionId: string, opts?: { limit?: number; before?: string }): Promise<ChatMessage[]>
```

Returns messages in `sortOrder` ascending, with `parts` always populated — rows that pre-date Bucket 2a have `parts` synthesized as `[{ kind: 'text', text: content }]`. `before` is a message id used for reverse-chronological pagination (returns messages with a lower `sortOrder` than the anchor). Default limit 100, max 500.

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

### `cancelInvocation(id, opts?)`

```ts
cancelInvocation(id: string, opts?: {
  gateway?: { request<T>(method: string, params?: unknown): Promise<T> };
}): Promise<{ cancelled: true; reconciled: boolean }>
```

Aborts the in-flight gateway session for a `running` invocation. Throws `notFound` (404) if the row is missing and `AppError(409)` if the invocation isn't running. Calls `sessions.abort` on the OpenClaw gateway with `sessionKey = "agent:<agentId>:mc-<sessionId>"` — the same shape the runner uses on dispatch. The runner's `lifecycle.error` handler is what actually transitions the row to `cancelled`; this function only dispatches the RPC.

If the gateway responds with a "session not running / not found / no session" error, this function reconciles the row directly via `failInvocation({ status: 'cancelled', error: 'stale' })` and returns `reconciled: true`. Other gateway errors are rethrown unchanged.

The `gateway` option is for tests — production callers omit it and the singleton from `getGatewayClient()` is used.

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

### `ensureDailyRhythmSeeded()`

```ts
ensureDailyRhythmSeeded(): Promise<void>
```

Idempotently seeds the `daily_rhythm` profile section + four phase entries (`Morning`, `Afternoon`, `Evening`, `Overnight`), each storing a JSON `{ start, end, userActive }` blob in `detail`. Called from `src/index.ts` startup and `src/db/seed.ts`. Existing rows are left untouched so user edits survive re-seeding. Drives the Briefings window math via `getDailyRhythm()`.

### `getDailyRhythm()`

```ts
getDailyRhythm(): Promise<Record<DailyRhythmPhase, { start: string; end: string; userActive: boolean }>>
```

Reads the four phase entries under `daily_rhythm`. Falls back to `DEFAULT_DAILY_RHYTHM` for any phase that's missing or has malformed JSON, so callers always get a complete map. Used by `briefs.service.computeBriefWindow`.

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

Reads and writes morning/afternoon/evening briefings, drives the continuous-drafting pipeline, and freezes briefs at reveal time. Phase 2 ships the cheap evidence-append path (no LLM); Phase 3 will add LLM synthesis behind the same `finalizeBrief` entry point. See [briefs.service.ts](briefs.service.ts).

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

```ts
generateBrief(input: { briefId?: string; date?: string; kind?: BriefKind }): Promise<Brief>
```

Manual regenerate — proxies to `finalizeBrief` for the resolved id. Accepts either an explicit `briefId` or a `(date, kind)` pair to look one up. Throws `AppError(400)` if neither shape is provided, `AppError(404)` if no matching row exists. Phase 2 ships without LLM synthesis, so this just freezes the current evidence with a deterministic fallback summary.

### `updateBrief(id, input)`

Partial update of `title`, `body`, `references` (each accepts `null` to clear) and `status`. Stamps `updatedAt`.

### `deleteBrief(id)`

Hard delete. Throws `AppError(404)` if the id is unknown.

### `upsertStubBrief(date, kind)`

Returns the existing `(date, kind)` row if one exists, otherwise inserts a `pending` stub. The stub is seeded with `revealAt`, `windowStart`, `windowEnd` computed from the user's daily rhythm at insert time so the values are frozen against later rhythm edits (per BRIEFINGS_PLAN §10 Q3). If an older row is missing those columns (pre-migration), they're backfilled.

### `computeBriefWindow(date, kind)`

```ts
computeBriefWindow(date: string, kind: BriefKind): Promise<{
  windowStart: string;
  windowEnd: string;
  revealAt: string;
}>
```

Computes the reveal-time + covered-window for a `(date, kind)` from `BRIEF_REVEAL_TIMES` and the user's daily rhythm. Morning briefs cover the previous day's evening reveal → today's morning reveal; afternoon covers morning → afternoon; evening covers afternoon → evening. Used by `upsertStubBrief`.

### `findBriefForInstant(instant)`

Returns the brief whose `[windowStart, windowEnd]` covers `instant` (an ISO timestamp), or `null` if no such row exists. Used by evidence-append hooks that don't already know which brief their event belongs to.

### `appendBriefEvidence(briefId, item)`

```ts
appendBriefEvidence(briefId: string, item: unknown): Promise<Brief>
```

Cheap-path evidence append. Validates `item` against `BriefEvidenceItemSchema`, merges it into the brief's `body.sections.<kind>` array (idempotent on the natural key per kind — e.g. `agentOutputId` for agent_work, `(source, refId)` for accomplishments), and updates the `references` index. Auto-transitions `pending → drafting`. Throws `AppError(409)` if the brief is already `ready` or `acknowledged` — reveal-time evidence should be deferred to the next brief, not retro-applied.

### `appendEvidenceForInstant(occurredAt, item)`

Convenience wrapper used by hooks (agent_output completion, task done, requirement check, …). Resolves the live brief whose window covers `occurredAt` via `findBriefForInstant`; if no brief is found (e.g. tonight's event landing in the post-evening gap) it lazy-stubs the next morning brief and appends there. Returns `{ briefId }` or `null` if the timestamp can't be mapped to any window. Best-effort — callers should `.catch(() => {})` so brief failures never block the user-facing operation.

### `finalizeBrief(briefId)`

Idempotent freeze. If the brief is already `ready`/`acknowledged`, returns it unchanged. Otherwise: writes a deterministic fallback summary derived from the accumulated evidence (Phase 3 will replace this with an LLM call), transitions to `ready`, and stamps `generatedAt`. Throws `AppError(404)` for unknown ids.

### `maybeLazyFinalize(briefId, asOf?)`

Lazy-finalize on read. If the brief's `revealAt` has passed and the row is still `pending`/`drafting`, calls `finalizeBrief`; otherwise returns the row unchanged. Wired into `GET /api/briefs/:id`. Defaults `asOf` to `now()`.

### `acknowledgeBrief(briefId)`

Marks the brief as opened. Auto-finalizes a still-drafting brief past `revealAt` before recording the acknowledgement so the user never sees a half-frozen brief. Idempotent — calling on an already-`acknowledged` row returns it unchanged. Sets `acknowledgedAt` to the first-open timestamp.

---

## Pending Parts Service

Bridges the stdio MCP server (a separate process) and the in-process runner that owns the chat-transcript write path. Bucket 2b interface tools (`render_card`, `suggest_replies`, `navigate`, `attach`) call `enqueuePart`; the runner calls `drainParts` from inside `flushAssistantBuffer` to merge them into the persisted `chat_messages.parts`. See [`pendingParts.service.ts`](pendingParts.service.ts).

### `getActiveInvocationId(sessionId)`

```ts
getActiveInvocationId(sessionId: string): Promise<string>
```

Returns the most recent `running` invocation id for the session. Throws `AppError(400)` when no in-flight turn exists (interface tools are only meaningful during an active assistant turn).

### `enqueuePart(sessionId, part)`

```ts
enqueuePart(sessionId: string, part: MessagePart): Promise<{ invocationId: string; partId: string }>
```

Resolves the active invocation, then inserts a `pending_message_parts` row with the next per-invocation `sortOrder`. Idempotency is the caller's responsibility (each interface tool call produces a fresh row).

### `drainParts(invocationId)`

```ts
drainParts(invocationId: string): Promise<MessagePart[]>
```

Reads every queued part for the invocation in insertion order and deletes the rows in the same call. Returns an empty array when the queue is empty. Called once per assistant-buffer flush.

---

## Attachments Service

Persists base64 file payloads supplied by the `attach` interface tool. See [`attachments.service.ts`](attachments.service.ts).

### `saveAttachment(input)`

```ts
saveAttachment(input: {
  sessionId: string;
  name: string;
  mimeType: string;
  data: string;     // base64
}): { url: string; size: number; storedPath: string }
```

Writes the decoded payload to `WORKSPACE_PATH/attachments/<sessionId>/<id>-<sanitizedName>` (extension appended from the mime type if missing) and returns a `workspace://attachments/...` URL the iOS client resolves through the existing workspace mount. Throws `AppError(400)` for missing or undecodable `data`.

---

## Cards Service

Bulk hydration for the `card` parts emitted into a chat turn. See [`cards.service.ts`](cards.service.ts). Backs `POST /api/cards/hydrate` and is intentionally a thin fan-out — most kinds are a single `inArray` query against the entity table; `slot` and `schedule_day` enrich with their assignment + outputs to match the existing schedule reads.

### `hydrateCards(refs)`

```ts
hydrateCards(refs: { cardType: CardKind; entityId: string }[]): Promise<{
  task?: Task[];
  goal?: Goal[];
  initiative?: Initiative[];
  agent_assignment?: AgentAssignment[];
  slot?: (Slot & { agentAssignment, outputs })[];
  schedule_day?: { date: string; slots: Slot[] }[];
}>
```

Groups refs by `cardType`, dedupes ids per kind, and fans out one query per kind in parallel. For `schedule_day` the `entityId` is an ISO date string; the bucket entry is `{ date, slots }` with all slots for that date sorted by `datetime`. Unknown ids are silently dropped (renderer falls back). Empty input returns `{}`; kinds with no refs are omitted entirely from the response.
