# Mission Control API — Blueprint

> Source of truth for the autonomous task/goal/schedule management system.
> Tech: **Fastify + TypeScript + Drizzle ORM + SQLite**

---

## 1. Project Structure

```
mission-control-api/
├── src/
│   ├── index.ts                 # Fastify bootstrap, plugin registration
│   ├── db/
│   │   ├── client.ts            # Drizzle + better-sqlite3 connection
│   │   ├── schema.ts            # All Drizzle table definitions
│   │   └── seed.ts              # Import from existing Obsidian markdown files
│   ├── routes/
│   │   ├── goals.ts             # /api/goals/*
│   │   ├── initiatives.ts       # /api/initiatives/*
│   │   ├── tasks.ts             # /api/tasks/*
│   │   ├── schedule.ts          # /api/schedule/*
│   │   └── board.ts             # /api/board/*
│   ├── services/
│   │   ├── goals.service.ts
│   │   ├── initiatives.service.ts
│   │   ├── tasks.service.ts
│   │   ├── schedule.service.ts
│   │   └── obsidian-sync.service.ts  # Write-through to Obsidian vault
│   ├── sync/
│   │   └── obsidian.ts          # Markdown generation templates
│   └── types/
│       └── index.ts             # Shared TypeScript types & Zod schemas
├── drizzle/
│   └── migrations/              # Generated migration SQL files
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── .env                         # VAULT_PATH, DB_PATH, PORT
└── BLUEPRINT.md                 # This file
```

---

## 2. Data Model (Drizzle Schema)

### 2.1 Goals

```typescript
export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),              // nanoid
  emoji: text('emoji').notNull(),           // e.g. "🙏"
  name: text('name').notNull().unique(),    // e.g. "Grow in Faith and Community"
  displayName: text('display_name').notNull(), // emoji + name: "🙏 Grow in Faith and Community"
  focus: text('focus', {
    enum: ['sprint', 'steady', 'simmer', 'dormant']
  }).notNull().default('steady'),
  focusIcon: text('focus_icon').notNull(),  // derived: 🔵/🟢/🟡/⚪️
  timeline: text('timeline'),               // free text: "lifelong", "Spring 2027"
  story: text('story'),                      // markdown body
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),   // ISO date
  updatedAt: text('updated_at').notNull(),   // ISO timestamp
  deletedAt: text('deleted_at'),               // ISO timestamp, null = active (soft delete)
});
```

### 2.2 Initiatives

```typescript
export const initiatives = sqliteTable('initiatives', {
  id: text('id').primaryKey(),
  emoji: text('emoji').notNull(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['active', 'backlog', 'paused', 'completed']
  }).notNull().default('active'),
  mission: text('mission'),                  // markdown
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
});
```

### 2.3 Tasks

```typescript
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  emoji: text('emoji').notNull(),            // inherited: goalEmoji + initEmoji
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  initiativeId: text('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['pending', 'assigned', 'in-progress', 'done', 'blocked', 'cancelled']
  }).notNull().default('pending'),
  objective: text('objective').notNull(),     // what this task accomplishes
  summary: text('summary'),                   // filled on completion
  slotId: text('slot_id').references(() => scheduleSlots.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
  deletedAt: text('deleted_at'),
});
```

### 2.4 Task Requirements

```typescript
export const taskRequirements = sqliteTable('task_requirements', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});
```

### 2.5 Task Tests

```typescript
export const taskTests = sqliteTable('task_tests', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
});
```

### 2.6 Task Outputs

```typescript
export const taskOutputs = sqliteTable('task_outputs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),            // display name or link text
  url: text('url'),                          // optional: file path, URL, wikilink
  createdAt: text('created_at').notNull(),
});
```

### 2.7 Schedule Slots

```typescript
export const scheduleSlots = sqliteTable('schedule_slots', {
  id: text('id').primaryKey(),
  weekPlanId: text('week_plan_id').notNull().references(() => weekPlans.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),              // YYYY-MM-DD
  time: text('time').notNull(),              // HH:00 (00, 02, 04 ... 22)
  datetime: text('datetime').notNull(),      // YYYY-MM-DDTHH:00 (for sorting/queries)
  type: text('type', {
    enum: ['maintenance', 'planning', 'task', 'brief', 'flex']
  }).notNull().default('flex'),
  status: text('status', {
    enum: ['pending', 'in-progress', 'done', 'skipped']
  }).notNull().default('pending'),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),  // allocated goal (for unassigned slots)
  note: text('note'),                        // completion note or skip reason
  dayOfWeek: text('day_of_week').notNull(),  // Monday, Tuesday, etc.
});
```

### 2.8 Week Plans

```typescript
export const weekPlans = sqliteTable('week_plans', {
  id: text('id').primaryKey(),
  weekStart: text('week_start').notNull().unique(),  // YYYY-MM-DD (Sunday)
  weekEnd: text('week_end').notNull(),
  generatedAt: text('generated_at').notNull(),
  // Allocation snapshot at generation time
  sprintSlots: integer('sprint_slots').notNull(),
  steadySlots: integer('steady_slots').notNull(),
  simmerSlots: integer('simmer_slots').notNull(),
  fixedSlots: integer('fixed_slots').notNull(),
  flexSlots: integer('flex_slots').notNull(),
});
```

### 2.9 Allocation Rules (per-goal slot targets within a week)

```typescript
export const weekGoalAllocations = sqliteTable('week_goal_allocations', {
  id: text('id').primaryKey(),
  weekPlanId: text('week_plan_id').notNull().references(() => weekPlans.id, { onDelete: 'cascade' }),
  goalId: text('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
  targetSlots: integer('target_slots').notNull(),
  assignedSlots: integer('assigned_slots').notNull().default(0),
});
```

---

## 3. API Routes

### 3.1 Goals — `/api/goals`

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/goals` | List all goals | — Query: `?focus=sprint&includeDeleted=true` | `Goal[]` (sorted: focus level then sortOrder) |
| `GET` | `/api/goals/:id` | Get goal with initiatives | — | `Goal & { initiatives: Initiative[] }` |
| `POST` | `/api/goals` | Create goal | `{ emoji, name, focus?, timeline?, story? }` | `Goal` |
| `PATCH` | `/api/goals/:id` | Update goal | `{ focus?, timeline?, story?, sortOrder? }` | `Goal` |
| `DELETE` | `/api/goals/:id` | Soft-delete goal (cascades to initiatives/tasks) | — | `204` |

### 3.2 Initiatives — `/api/initiatives`

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/initiatives` | List initiatives | — Query: `?goalId=X&status=active&includeDeleted=true` | `Initiative[]` |
| `GET` | `/api/initiatives/:id` | Get with tasks | — | `Initiative & { tasks: Task[], goal: Goal }` |
| `POST` | `/api/initiatives` | Create initiative | `{ emoji, name, goalId, mission?, status? }` | `Initiative` |
| `PATCH` | `/api/initiatives/:id` | Update | `{ status?, mission?, goalId?, sortOrder? }` | `Initiative` |
| `POST` | `/api/initiatives/:id/complete` | Complete initiative | — | `Initiative` |
| `DELETE` | `/api/initiatives/:id` | Soft-delete (cascades to tasks) | — | `204` |

### 3.3 Tasks — `/api/tasks`

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/tasks` | List tasks | — Query: `?initiativeId=X&status=pending&status=assigned&includeDeleted=true` | `Task[]` (with requirements, tests) |
| `GET` | `/api/tasks/:id` | Get full task | — | `Task & { requirements, tests, outputs, initiative, slot }` |
| `POST` | `/api/tasks` | Create task | `{ name, initiativeId, objective, requirements: string[], tests?: string[] }` | `Task` |
| `PATCH` | `/api/tasks/:id` | Update task | `{ objective?, status?, sortOrder? }` | `Task` |
| `POST` | `/api/tasks/:id/start` | Set status → in-progress | — | `Task` |
| `POST` | `/api/tasks/:id/done` | Complete task | `{ summary, outputs?: { label, url? }[] }` | `Task` (validates all reqs checked) |
| `POST` | `/api/tasks/:id/block` | Block task | `{ reason }` | `Task` |
| `POST` | `/api/tasks/:id/cancel` | Cancel task | — | `Task` |
| `DELETE` | `/api/tasks/:id` | Soft-delete task | — | `204` |

#### Task Requirements sub-routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/:id/requirements` | Add requirement `{ description }` |
| `PATCH` | `/api/tasks/:taskId/requirements/:reqId` | Update `{ description?, completed? }` |
| `POST` | `/api/tasks/:taskId/requirements/:reqId/check` | Toggle completed → true |
| `POST` | `/api/tasks/:taskId/requirements/:reqId/uncheck` | Toggle completed → false |
| `DELETE` | `/api/tasks/:taskId/requirements/:reqId` | Remove requirement |

#### Task Tests sub-routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/:id/tests` | Add test `{ description }` |
| `PATCH` | `/api/tasks/:taskId/tests/:testId` | Update `{ description?, passed? }` |
| `DELETE` | `/api/tasks/:taskId/tests/:testId` | Remove test |

#### Task Outputs sub-routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/tasks/:id/outputs` | Add output `{ label, url? }` |
| `DELETE` | `/api/tasks/:taskId/outputs/:outputId` | Remove output |

### 3.4 Schedule — `/api/schedule`

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/api/schedule/today` | Get today's slots | — | `ScheduleSlot[]` (with task details) |
| `GET` | `/api/schedule/week?weekStart=YYYY-MM-DD` | Get week's slots | — | `{ weekPlan, slots: ScheduleSlot[], allocations: WeekGoalAllocation[] }` |
| `POST` | `/api/schedule/generate` | Generate week plan | `{ weekStart?: string }` (defaults to current week's Sunday) | `{ weekPlan, slots, allocations }` |
| `POST` | `/api/schedule/sync` | Sync SCHEDULE.md from current week | `{ date?: string }` | `{ synced: true }` |
| `PATCH` | `/api/schedule/slots/:id` | Update slot | `{ status?, taskId?, note? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/slots/:id/done` | Mark slot done | `{ note? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/slots/:id/skip` | Skip slot | `{ reason? }` | `ScheduleSlot` |
| `POST` | `/api/schedule/assign` | Assign task to slot | `{ taskId, slotId }` | `ScheduleSlot` |

### 3.5 Board — `/api/board`

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/board` | Full board state as JSON | `{ goals: GoalWithInitiatives[], stats, weekSummary }` |
| `POST` | `/api/board/refresh` | Regenerate Obsidian Board.md | `{ refreshed: true, path }` |


### 3.6 Sync — `/api/sync`

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `POST` | `/api/sync/obsidian` | Full sync: regenerate all Obsidian files from DB | `{ goals, initiatives, tasks, board, schedule }` (counts) |
| `POST` | `/api/sync/import` | One-time import from existing Obsidian markdown → DB | `{ imported: { goals, initiatives, tasks } }` |

---

## 4. Business Logic

### 4.1 Focus Level → Allocation Formula (per week, 84 total slots)

| Category | Slots | Rule |
|----------|-------|------|
| Fixed | 8 | 7 midnight maintenance + 1 Sunday planning (02:00) |
| Sprint | 30 | Split evenly across Sprint-focus goals |
| Steady | 12 | Split evenly across Steady-focus goals |
| Simmer | 4 | Split evenly across Simmer-focus goals (round per goal) |
| Flex | remainder (~30) | Unallocated, available for reactive work |

### 4.2 Focus Icon Derivation

```typescript
const FOCUS_ICONS = { sprint: '🔵', steady: '🟢', simmer: '🟡', dormant: '⚪️' };
```

Always derived from `focus` — never stored independently (computed on read or set on write).

### 4.3 Display Name

`displayName = emoji + ' ' + name` — always computed/synced on create/update.

### 4.4 Task Emoji Inheritance

When creating a task, emoji = goal's emoji + initiative's emoji.
E.g., Goal 🙏 + Initiative 📿 = Task prefix 🙏📿.

### 4.5 Task Completion Validation

`POST /tasks/:id/done` must validate:
- All `taskRequirements` where `completed = true` (or zero requirements)
- If any unchecked requirements → 400 error with list of incomplete ones

### 4.6 Initiative Completion

`POST /initiatives/:id/complete`:
- Sets status → `completed`
- All non-done/non-cancelled tasks under it get set to `cancelled`

### 4.7 Week Plan Generation

`POST /schedule/generate`:
1. Calculate allocation per focus level
2. Create 12 slots × 7 days = 84 slots
3. Assign fixed slots (00:00 = maintenance, Sunday 02:00 = planning)
4. Assign brief slots (08:00 = morning, 12:00 = afternoon, 20:00 = evening)
5. Distribute goal-allocated slots round-robin across remaining times
6. Pull actionable tasks (pending/assigned, non-dormant goals) and assign to goal slots
7. Remaining slots = flex

### 4.8 Schedule Sync (SCHEDULE.md generation)

`POST /schedule/sync`:
- Read slots for today + tomorrow from DB
- Generate markdown table format matching current SCHEDULE.md structure
- Write to both workspace and Obsidian paths
- Preserve ✅ statuses from existing file (don't overwrite completed slots)

---

### 4.9 Soft Deletes

All entity deletions are soft deletes (`deletedAt` timestamp set, row preserved).
- Default queries filter out soft-deleted rows (`WHERE deletedAt IS NULL`)
- All list endpoints accept `?includeDeleted=true` to show everything
- Cascading soft delete: deleting a goal soft-deletes its initiatives and their tasks
- Obsidian markdown files for soft-deleted entities are removed from disk (regenerable on restore)
- No restore endpoint in v1 — restore via direct DB update if needed

### 4.10 Goal Sorting

Goals always sort primarily by focus level in this order: sprint → steady → simmer → dormant.
Within the same focus level, `sortOrder` determines position (ascending, lower = higher priority).
This applies to all list endpoints and board generation.

Implementation: use a CASE expression or application-level sort with focus level mapped to integers:
`{ sprint: 0, steady: 1, simmer: 2, dormant: 3 }`

---

## 5. Obsidian Sync Layer

### 5.1 Write-Through Strategy

Every mutation (create/update/delete) on goals, initiatives, or tasks:
1. Updates SQLite (source of truth)
2. Regenerates the corresponding Obsidian markdown file
3. Updates parent file links (e.g., initiative list in goal doc)

### 5.2 File Paths

| Entity | Path Template |
|--------|--------------|
| Goal | `{VAULT}/🏆 Goals/{displayName}.md` |
| Initiative | `{VAULT}/☑️ Initiatives/{displayName}.md` |
| Task (active) | `{VAULT}/🫡 Tasks/{displayName}.md` |
| Task (done) | `{VAULT}/🫡 Tasks/done/{displayName}.md` |
| Board | `{VAULT}/📋 Board.md` |
| Schedule | `{VAULT}/🗓️ Schedule.md` + `{WORKSPACE}/SCHEDULE.md` |
| Week | `{VAULT}/🗓️ Week.md` + `{WORKSPACE}/WEEK.md` |

### 5.3 Markdown Templates

Must reproduce the exact YAML frontmatter + body format currently used:

**Goal:**
```markdown
---
type: goal
emoji: "{emoji}"
focus: "{focus}"
focus_icon: "{focusIcon}"
timeline: "{timeline}"
created: {createdAt}
---

# {displayName}

## Story
{story}

## Initiatives
- [[{initiative.displayName}]]
...
```

**Initiative:**
```markdown
---
type: initiative
emoji: "{emoji}"
goal: "[[{goal.displayName}]]"
status: "{status}"
created: {createdAt}
---

# {displayName}

**Goal:** [[{goal.displayName}]]
**Status:** {status}

## Mission
{mission}

## Tasks
- [[{task.displayName}]]
...
```

**Task:**
```markdown
---
type: task
emoji: "{emoji}"
initiative: "[[{initiative.displayName}]]"
status: "{status}"
slot: "{slot.datetime}"
created: {createdAt}
completed: "{completedAt}"
---

# {displayName}

**Initiative:** [[{initiative.displayName}]]
**Status:** {status}

## Objective
{objective}

## Requirements
- [x] {completed requirement}
- [ ] {incomplete requirement}

## Test Plan
- [x] {passed test}
- [ ] {pending test}

## Output
- {output.label}: {output.url}
```

### 5.4 Wikilinks

All internal references in generated markdown MUST use Obsidian wikilinks:
- `[[🙏 Grow in Faith and Community]]` — not `[text](path)`
- This is a hard requirement for vault graph connectivity

---

## 6. Configuration (`.env`)

```env
PORT=3737
DB_PATH=./data/mission-control.db
VAULT_PATH=/Users/michaelfocacci/Library/Mobile Documents/iCloud~md~obsidian/Documents/Main
WORKSPACE_PATH=/Users/michaelfocacci/.openclaw/workspace
```

---

## 7. Seed / Import

`POST /api/sync/import` performs a one-time migration:

1. Scan `🏆 Goals/*.md` — parse YAML frontmatter → insert into `goals` table
2. Scan `☑️ Initiatives/*.md` — parse frontmatter, resolve goal wikilink → insert, set `goalId`
3. Scan `🫡 Tasks/*.md` + `🫡 Tasks/done/*.md` — parse frontmatter, resolve initiative wikilink, parse requirement/test checkboxes → insert task + requirements + tests
4. Return counts of imported entities

Parser must handle:
- YAML frontmatter between `---` fences
- Quoted values: `emoji: "🙏"`
- Wikilinks in values: `goal: "[[🙏 Grow in Faith and Community]]"`
- Checkbox state: `- [x]` vs `- [ ]`
- Story/mission/objective extracted from markdown sections

---

## 8. Dependencies

```json
{
  "dependencies": {
    "fastify": "^5",
    "@fastify/cors": "^10",
    "drizzle-orm": "^0.39",
    "better-sqlite3": "^11",
    "nanoid": "^5",
    "zod": "^3",
    "dotenv": "^16"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "drizzle-kit": "^0.30",
    "tsx": "^4",
    "@types/better-sqlite3": "^7",
    "@types/node": "^22"
  }
}
```

---

## 9. Build Order (implementation phases)

### Phase 1 — Foundation
1. Project scaffold: `package.json`, `tsconfig.json`, `drizzle.config.ts`, `.env`
2. DB connection (`src/db/client.ts`)
3. Full Drizzle schema (`src/db/schema.ts`)
4. Run `drizzle-kit generate` + `drizzle-kit migrate`
5. Seed script: import from Obsidian markdown (`src/db/seed.ts`)

### Phase 2 — Core CRUD
6. Goals routes + service (full CRUD)
7. Initiatives routes + service (full CRUD + complete action)
8. Tasks routes + service (full CRUD + start/done/block/cancel + requirements/tests/outputs sub-routes)
9. Zod validation schemas for all request bodies

### Phase 3 — Schedule Engine
10. Week plan generation logic (allocation formula)
11. Schedule routes (generate, sync, today, week, slot updates, assign)
12. Board routes (JSON board, refresh Obsidian)

### Phase 4 — Obsidian Sync
13. Markdown template engine (generate goal/initiative/task/board/schedule markdown)
14. Write-through hooks on all mutation services
15. Full sync endpoint
16. Import endpoint (one-time migration)

### Phase 5 — Polish
17. Error handling middleware (consistent error responses)
18. Request logging
19. Startup: auto-run migrations, create data dir
20. npm scripts: `dev`, `build`, `start`, `migrate`, `seed`

---

## 10. Non-Goals (for now)

- Authentication (single-user, localhost only)
- WebSocket/SSE real-time updates
- Web UI (separate project, consumes this API)
- Cron job management (stays in OpenClaw)
- Brief generation (stays in OpenClaw prompts)
- Memory/knowledge graph management (separate concern)

---

## 11. CLI Compatibility

After the API is running, the existing shell scripts (`goal`, `initiative`, `task`, `task-assign`, `board-refresh`, `schedule-done`, `week-plan`) can be refactored to thin `curl` wrappers hitting the API. This is a follow-up task, not part of the initial build.

---

## 12. Testing

Manual testing via `curl` or Insomnia/Hoppscotch for now. Automated tests are a follow-up.

Smoke test script (`scripts/smoke-test.sh`):
1. Create a goal
2. Create an initiative under it
3. Create a task under the initiative
4. Check requirement
5. Complete task
6. Generate week plan
7. Verify board JSON
8. Verify Obsidian files written

