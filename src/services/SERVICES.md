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
