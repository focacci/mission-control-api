# Task Model Refactor Plan

Self-contained spec for a clean agent session. Scope spans both repos:
- `/Users/michaelfocacci/dev/Intella/mission-control-api/` (Fastify + Drizzle + SQLite)
- `/Users/michaelfocacci/dev/Intella/mission-control-ios/` (SwiftUI)

## Contents
- [Motivation](#motivation)
- [Target Model](#target-model)
- [What Changes](#what-changes)
- [DB Schema Changes](#db-schema-changes)
- [API Layer (mission-control-api)](#api-layer-mission-control-api)
- [MCP Tools](#mcp-tools)
- [iOS Layer (mission-control-ios)](#ios-layer-mission-control-ios)
- [Docs to Update](#docs-to-update)
- [Execution Order](#execution-order)
- [Verification](#verification)
- [Open Items / Non-Goals](#open-items--non-goals)

---

## Motivation

Today the model conflates two different things:

1. **Work a human does** (read, think, write, make a decision)
2. **Work an agent does on the human's behalf** (research, draft, summarize, fetch)

Tasks currently carry both, plus their own `tests`, plus a single `slotId` for scheduling. That makes it impossible for an agent to do supplemental work *around* a task on its own time budget, and it pins a task to exactly one calendar slot.

**New mental model:**
- **Task** — something the user will apply to real life. Always human-driven. Has an objective, requirements, and agent assignments.
- **Requirement** — a criterion that must be satisfied before the task is done. Owns its own **Tests** (checks the user runs to confirm the requirement is met).
- **Agent Assignment (AA)** — a discrete thing an agent can do autonomously to help the user achieve the task. Lives under a task. Scheduling happens *here*, not on the task. One AA can span multiple slots.
- **Schedule Slot** — a time window. Now links to an AA (not a Task). Owns the **Outputs** produced while the agent ran during that slot (files created/updated/deleted).

---

## Target Model

```
goals
 └── initiatives
       └── tasks               (human-owned; no slot link; no tests)
             ├── task_requirements
             │     └── requirement_tests      [NEW — replaces task_tests]
             └── agent_assignments            [NEW]
                   └── (linked from schedule_slots.agent_assignment_id)

week_plans
 └── schedule_slots
       ├── agent_assignment_id  [REPLACES task_id]
       ├── goal_id
       └── slot_outputs         [NEW — replaces task_outputs]
```

### Entity summaries

**`tasks`** — human-facing. Fields: `id, name, displayName, initiativeId, status, objective, summary, sortOrder, createdAt, updatedAt, completedAt`. **Remove `slotId`.** Status enum becomes `pending | in-progress | done | blocked | cancelled` (drop `assigned` — "assigned" was a slot-link artifact and no longer applies).

**`task_requirements`** — unchanged shape. Still blocks `doneTask()` if any `completed = false`.

**`requirement_tests`** (new) — `id, requirementId (FK CASCADE), description, passed, sortOrder`. Replaces `task_tests`. A requirement is not "done" in the UI until all its tests pass (but DB-level blocking still lives on `task_requirements.completed` — tests are guidance for the human checking the requirement).

**`agent_assignments`** (new) — `id, taskId (FK CASCADE), title, instructions, agentId (FK agents SET NULL, nullable), completed (boolean, default false), completedAt (nullable), sortOrder, createdAt, updatedAt`. Only lifecycle flag is `completed` — set true when a slot firing finishes the AA. No intermediate states.

**`schedule_slots`** — replace `task_id` column with `agent_assignment_id` (nullable, FK `agent_assignments.id` ON DELETE SET NULL). Type enum: rename `task` → `agent_assignment` (i.e. `maintenance | planning | agent_assignment | brief | flex`). Everything else stays.

**`slot_outputs`** (new) — `id, slotId (FK schedule_slots CASCADE), label, url (nullable), kind (enum: created | updated | deleted), createdAt`. Replaces `task_outputs`. Represents artifacts the agent touched while running during that slot.

---

## What Changes

| Concern | Before | After |
|---|---|---|
| Tests belong to | Task (`task_tests`) | Requirement (`requirement_tests`) |
| Outputs belong to | Task (`task_outputs`) | Slot (`slot_outputs`) |
| Slot links to | Task (`slot.taskId` + `task.slotId`) | Agent Assignment (`slot.agentAssignmentId`) |
| Slots per unit | 1 per task | N per AA |
| Agent Assignments | — | New table, child of Task |
| Task status enum | pending/assigned/in-progress/done/blocked/cancelled | pending/in-progress/done/blocked/cancelled |
| Slot type enum | maintenance/planning/task/brief/flex | maintenance/planning/agent_assignment/brief/flex |
| Week-plan auto-assignment | Assigns pending tasks to goal slots | Assigns pending (not-completed) AAs to goal slots |

**No data migration.** Drop and recreate the SQLite DB. This project is still pre-prod / mock data.

---

## DB Schema Changes

File: [src/db/schema.ts](src/db/schema.ts)

1. **Remove** `slotId` column from `tasks`.
2. **Update** `tasks.status` enum: `['pending', 'in-progress', 'done', 'blocked', 'cancelled']` (drop `assigned`).
3. **Delete** `taskTests` table.
4. **Delete** `taskOutputs` table.
5. **Rename** `scheduleSlots.taskId` → `scheduleSlots.agentAssignmentId`. Add real FK: `.references(() => agentAssignments.id, { onDelete: 'set null' })`.
6. **Update** `scheduleSlots.type` enum: `['maintenance', 'planning', 'agent_assignment', 'brief', 'flex']`.
7. **Add** `requirementTests`:
   ```ts
   export const requirementTests = sqliteTable('requirement_tests', {
     id: text('id').primaryKey(),
     requirementId: text('requirement_id')
       .notNull()
       .references(() => taskRequirements.id, { onDelete: 'cascade' }),
     description: text('description').notNull(),
     passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
     sortOrder: integer('sort_order').notNull().default(0),
   });
   ```
8. **Add** `agentAssignments`:
   ```ts
   export const agentAssignments = sqliteTable('agent_assignments', {
     id: text('id').primaryKey(),
     taskId: text('task_id')
       .notNull()
       .references(() => tasks.id, { onDelete: 'cascade' }),
     title: text('title').notNull(),
     instructions: text('instructions').notNull(),
     agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
     completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
     completedAt: text('completed_at'),
     sortOrder: integer('sort_order').notNull().default(0),
     createdAt: text('created_at').notNull(),
     updatedAt: text('updated_at').notNull(),
   });
   ```
9. **Add** `slotOutputs`:
   ```ts
   export const slotOutputs = sqliteTable('slot_outputs', {
     id: text('id').primaryKey(),
     slotId: text('slot_id')
       .notNull()
       .references(() => scheduleSlots.id, { onDelete: 'cascade' }),
     label: text('label').notNull(),
     url: text('url'),
     kind: text('kind', { enum: ['created', 'updated', 'deleted'] }).notNull(),
     createdAt: text('created_at').notNull(),
   });
   ```

After editing the schema, regenerate and push: `pnpm drizzle-kit generate && pnpm drizzle-kit push` (or whatever the project uses — check `package.json` scripts). Delete the local SQLite file first so there's no migration conflict.

---

## API Layer (mission-control-api)

### Types — [src/types/index.types.ts](src/types/index.types.ts)

- **Remove** `AddTestSchema`, `UpdateTestSchema`, `AddOutputSchema` (Task-scoped).
- **Remove** `task.slotId` from `UpdateTaskSchema` / `CreateTaskSchema`.
- **Remove** `assigned` from task status enums.
- **Add** Zod schemas:
  - `CreateAgentAssignmentSchema` (taskId path, body: title, instructions, agentId?)
  - `UpdateAgentAssignmentSchema` (partial: title?, instructions?, agentId?, sortOrder?)
  - `CompleteAgentAssignmentSchema` (no body or body: completedAt?)
  - `AddRequirementTestSchema` (description)
  - `UpdateRequirementTestSchema` (description?, passed?)
  - `AddSlotOutputSchema` (label, url?, kind)
- Export inferred input types for all the above.
- **Update** `AssignTaskSchema` → `AssignAgentAssignmentSchema` with `{ agentAssignmentId, slotId }`.

### Services

[src/services/tasks.service.ts](src/services/tasks.service.ts):
- Drop all `*Test*` functions (`addTest`, `updateTest`, `deleteTest`).
- Drop all `*Output*` functions (`addOutput`, `deleteOutput`).
- Drop `task.slotId` handling in `createTask`, `updateTask`, `startTask`, `doneTask`.
- `doneTask` validation stays: still requires all requirements completed. (Tests are informational — do not block on test pass.)
- `listTasks` / `getTask`: load requirements + their nested tests in bulk; load agent assignments; stop loading outputs (they're on slots now).

[src/services/requirements.service.ts](src/services/requirements.service.ts) (new file — lift requirement CRUD out of tasks.service.ts for clarity):
- `addRequirement`, `updateRequirement`, `checkRequirement`, `uncheckRequirement`, `deleteRequirement` — same behavior as today but move here.
- `addRequirementTest`, `updateRequirementTest`, `passRequirementTest`, `unpassRequirementTest`, `deleteRequirementTest`.

[src/services/agentAssignments.service.ts](src/services/agentAssignments.service.ts) (new):
- `listAgentAssignmentsForTask(taskId)`
- `getAgentAssignment(id)` — include linked slots
- `createAgentAssignment(taskId, input)`
- `updateAgentAssignment(id, input)`
- `completeAgentAssignment(id)` — sets `completed = true`, `completedAt = now()`. Idempotent.
- `deleteAgentAssignment(id)` — cascades slot nulls via FK.

[src/services/schedule.service.ts](src/services/schedule.service.ts):
- Rename `assignTask` → `assignAgentAssignment(agentAssignmentId, slotId)`. **No bidirectional sync** anymore — slot holds the only pointer. Allow one AA to own multiple slots (do not unlink other slots of the same AA when assigning a new one).
- Rename `unassignTask` → `unassignAgentAssignment(slotId)`.
- `enrichSlotsWithTasks` → `enrichSlotsWithAssignments`: join slot → AA → task (so the UI can still show "working on <task> via <AA>").
- `generateWeekPlan`:
  - Flex slots allocated to goals become type `agent_assignment` (was `task`).
  - Auto-assign pool: replace pending tasks with pending AAs (`completed = false`) whose task's initiative rolls up to an active goal. Map AA → goal via `agent_assignment.task.initiative.goal_id`.
  - Writes `slot.agentAssignmentId`. Does not change any Task row's status (tasks are for humans; auto-scheduling doesn't touch their state).
- `doneSlot`: if slot has an AA, optionally auto-complete the AA when the slot is marked done (design choice — do this only if the slot is the AA's last scheduled slot that is not yet done). Simpler alternative for v1: leave AA completion as an explicit action, and have `doneSlot` just accept outputs and mark the slot done. **Go with the explicit variant for v1.**

### Routes

[src/routes/tasks.routes.ts](src/routes/tasks.routes.ts):
- Remove all `/tests` sub-routes.
- Remove all `/outputs` sub-routes.
- Keep task CRUD and lifecycle.
- Remove any `slotId` handling in request bodies.

[src/routes/requirements.routes.ts](src/routes/requirements.routes.ts) (new — or keep nested under tasks.routes.ts; prefer a new file for clarity):
- `POST   /api/tasks/:taskId/requirements`
- `PATCH  /api/requirements/:reqId`
- `POST   /api/requirements/:reqId/check`
- `POST   /api/requirements/:reqId/uncheck`
- `DELETE /api/requirements/:reqId`
- `POST   /api/requirements/:reqId/tests`
- `PATCH  /api/requirements/:reqId/tests/:testId`
- `POST   /api/requirements/:reqId/tests/:testId/pass`
- `POST   /api/requirements/:reqId/tests/:testId/unpass`
- `DELETE /api/requirements/:reqId/tests/:testId`

[src/routes/agentAssignments.routes.ts](src/routes/agentAssignments.routes.ts) (new):
- `GET    /api/tasks/:taskId/agent-assignments`
- `POST   /api/tasks/:taskId/agent-assignments`
- `GET    /api/agent-assignments/:id`
- `PATCH  /api/agent-assignments/:id`
- `POST   /api/agent-assignments/:id/complete`
- `DELETE /api/agent-assignments/:id`

[src/routes/schedule.routes.ts](src/routes/schedule.routes.ts):
- `POST   /api/schedule/assign` body shape: `{ agentAssignmentId, slotId }` (was `{ taskId, slotId }`).
- `DELETE /api/schedule/slots/:id/assignment` (replaces `/slots/:id/task`).
- New: `POST /api/schedule/slots/:id/outputs` — body `{ label, url?, kind }`.
- New: `DELETE /api/schedule/slots/:slotId/outputs/:outputId`.

Register any new route files in [src/index.ts](src/index.ts).

---

## MCP Tools

[src/mcp/server.ts](src/mcp/server.ts):

- `tasks` tool: drop `add_test`, `update_test`, `delete_test`, `add_output`, `delete_output`. Drop `slotId` from task create/update. Status enum updated.
- **New** `requirements` tool: actions for requirement + requirement-test CRUD (list, get, add, update, check, uncheck, delete, add_test, update_test, pass_test, unpass_test, delete_test).
- **New** `agent_assignments` tool: actions list (by task), get, create, update, complete, delete.
- `schedule` tool: rename `assign`/`unassign` actions to operate on `agentAssignmentId`. Add `add_output`, `delete_output` actions targeting slot id.

---

## iOS Layer (mission-control-ios)

### Models — [MissionControl/Shared/Models/](MissionControl/Shared/Models/)

[Task.swift](MissionControl/Shared/Models/Task.swift):
- `MCTask`: drop `slotId`, `slot`, and `tests`. Drop `outputs`. Drop `.assigned` from status enum. Add `agentAssignments: [AgentAssignment]?`.
- `Requirement`: add `tests: [RequirementTest]?`.
- `TaskTest` → rename to `RequirementTest` (same shape: id, description, passed).
- Remove `TaskOutput`.

New files:
- `MissionControl/Shared/Models/AgentAssignment.swift`:
  ```swift
  struct AgentAssignment: Codable, Identifiable, Hashable {
      let id: String
      let taskId: String
      var title: String
      var instructions: String
      var agentId: String?
      var completed: Bool
      var completedAt: String?
      var sortOrder: Int
      var createdAt: String
      var updatedAt: String
      var slots: [ScheduleSlot]?   // optional enrichment
  }
  ```
- `MissionControl/Shared/Models/SlotOutput.swift`:
  ```swift
  struct SlotOutput: Codable, Identifiable, Hashable {
      enum Kind: String, Codable { case created, updated, deleted }
      let id: String
      let slotId: String
      var label: String
      var url: String?
      var kind: Kind
      var createdAt: String
  }
  ```

[ScheduleSlot.swift](MissionControl/Shared/Models/ScheduleSlot.swift):
- Replace `taskId`/`task` with `agentAssignmentId`/`agentAssignment: AgentAssignment?`.
- Add `outputs: [SlotOutput]?`.
- `SlotType`: rename `.task` → `.agentAssignment` (raw value `"agent_assignment"`).

### Services — [MissionControl/Shared/Services/](MissionControl/Shared/Services/)

Update API client(s) to match new route shapes. New endpoints for AAs, requirement-tests, and slot outputs. Remove task-test / task-output calls.

### Views

Delete:
- [MissionControl/Views/Sections/TestsCard.swift](MissionControl/Views/Sections/TestsCard.swift) — behavior moves under Requirements.
- [MissionControl/Views/Sections/OutputsCard.swift](MissionControl/Views/Sections/OutputsCard.swift) — concept moves under Slots.

Update:
- [RequirementsCard.swift](MissionControl/Views/Sections/RequirementsCard.swift): each requirement row gets a disclosure (or detail pane) that lists its tests with pass/fail toggles, add, and delete.
- Task detail screen composition: Header → Requirements section → Agent Assignments section. (No Tests section, no Outputs section at task level.)
- [TaskActionBar.swift](MissionControl/Views/Sections/TaskActionBar.swift): remove any `.assigned` handling; keep start/done/block/cancel.

New view files (proposed names, adjust to local conventions):
- `MissionControl/Views/Sections/AgentAssignmentsCard.swift` — list of AAs under a task, create/edit, shows completion state, quick "schedule" entry.
- `MissionControl/Views/AgentAssignment/AgentAssignmentDetailView.swift` — instructions editor, agent picker, linked slots list, complete button.
- `MissionControl/Views/Sections/RequirementTestsView.swift` (or inline into `RequirementsCard`) — nested tests UI.
- `MissionControl/Views/Schedule/SlotOutputsCard.swift` — rendered in `SlotDetailView`, lists outputs with kind badge and link.

Update schedule views:
- [SlotDetailView.swift](MissionControl/Views/Schedule/SlotDetailView.swift): show linked AA (and its parent task), swap task-picker for AA-picker (scoped by goal of the slot where possible), include SlotOutputsCard.
- [ScheduleTaskSheet.swift](MissionControl/Views/Schedule/ScheduleTaskSheet.swift): rename to `ScheduleAssignmentSheet.swift`; lists pending AAs (not tasks).
- [TimeSlotView.swift](MissionControl/Views/Schedule/TimeSlotView.swift): display now reads from `slot.agentAssignment?.title` + `slot.agentAssignment?.task?.displayName`.
- [DayScheduleView.swift](MissionControl/Views/Schedule/DayScheduleView.swift) / [MonthScheduleView.swift](MissionControl/Views/Schedule/MonthScheduleView.swift): any filter predicates that check `slot.type == "task"` → `"agent_assignment"`, and any `slot.taskId`/`slot.task` reads → `slot.agentAssignmentId`/`slot.agentAssignment`.

[ChatContextStore.swift](MissionControl/Views/FloatingChat/ChatContextStore.swift): if it references task tests / outputs as context hints, update to reference requirements + agent assignments.

---

## Docs to Update

Per the API repo's `CLAUDE.md` convention, update in-tree docs alongside code:
- [src/db/SCHEMAS.md](src/db/SCHEMAS.md) — every table change
- [src/routes/ROUTES.md](src/routes/ROUTES.md) — new/removed routes + request/response shapes
- [src/services/SERVICES.md](src/services/SERVICES.md) — service function signatures
- [src/types/TYPES.md](src/types/TYPES.md) — new Zod schemas and inferred types
- [README.md](README.md) — the "hierarchy" summary (Goals → Initiatives → Tasks → Requirements + Agent Assignments; Slots own Outputs)
- `CLAUDE.md` in both repos: update the "Hierarchy" blurb so future sessions load the right mental model.

After refactor, update the memory file `project_intella_mvp.md` in the user's memory dir to reflect the new hierarchy description.

---

## Execution Order

Work in this sequence to keep the tree compiling at each checkpoint:

1. **Schema** — edit `schema.ts`, blow away local SQLite, regenerate + push.
2. **Types** — update Zod schemas + inferred types in `index.types.ts`.
3. **Services** — tasks → requirements (new file) → agentAssignments (new file) → schedule.
4. **Routes** — tasks → requirements → agentAssignments → schedule; register in `index.ts`.
5. **MCP** — update `tasks` tool; add `requirements`, `agent_assignments` tools; update `schedule` tool.
6. **API docs** — SCHEMAS / ROUTES / SERVICES / TYPES / README / CLAUDE.
7. **iOS models** — Task.swift, ScheduleSlot.swift, new AgentAssignment.swift, new SlotOutput.swift.
8. **iOS services** — API client updates.
9. **iOS views** — delete TestsCard / OutputsCard; add AgentAssignmentsCard + detail; nest tests into RequirementsCard; update schedule views.
10. **Seed / mock data** — if there's a seeding script, rewrite it to produce tasks with requirements-with-tests and agent-assignments with slots.

---

## Verification

API:
- `pnpm typecheck` (or `tsc --noEmit`) passes.
- `pnpm test` (if suite exists) passes; add/adjust tests for new services.
- Manual curl: create task → add requirement → add test on requirement → add AA → generate week plan → confirm slot has `agent_assignment_id`, not `task_id` → add output on slot → complete AA.

iOS:
- Builds in Xcode for simulator.
- Task detail screen renders: header, requirements (with nested tests), agent assignments. No tests-at-task section. No outputs-at-task section.
- Slot detail: shows AA + parent task, outputs list, output kinds render correctly.
- Drag / assign flow on schedule lets you pick a pending AA for a flex/agent slot.

---

## Open Items / Non-Goals

- **Multi-slot AA runtime semantics.** When an AA spans multiple slots, how does the agent resume across slots? Out of scope for this refactor — just let the schema support it; runtime is a separate problem handled by the Phase-2 runner work in [CONTROL_LAYER_PLAN.md](CONTROL_LAYER_PLAN.md).
- **Auto-completing AAs from slot completion.** v1 keeps AA completion explicit. Revisit after the runner lands.
- **Goal-rollup for AAs.** Auto-assignment needs `agent_assignment → task → initiative → goal`. Build a `buildAssignmentGoalMap` helper analogous to the existing `buildTaskGoalMap` in `schedule.service.ts`.
- **Backwards-compat / migration.** None. Drop and re-seed.
- **Renaming the `agent` MCP tool vs existing `agents` MCP concerns.** Keep distinct names: `agents` (the agent entity) vs `agent_assignments` (units of agent work under a task).
