# Database Schemas

## Contents

- [`goals`](#goals)
- [`initiatives`](#initiatives)
- [`tasks`](#tasks)
- [`task_requirements`](#task_requirements)
- [`task_tests`](#task_tests)
- [`task_outputs`](#task_outputs)
- [`week_plans`](#week_plans)
- [`schedule_slots`](#schedule_slots)
- [`week_goal_allocations`](#week_goal_allocations)
- [Relationships Overview](#relationships-overview)

---

Defined in [schema.ts](schema.ts) using Drizzle ORM with a `better-sqlite3` driver. All IDs are `nanoid`-generated strings. Timestamps are ISO 8601 strings stored as `text`.

---

## `goals`

The top-level planning unit. A goal represents a long-term area of life or work the user is pursuing.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `emoji` | `text` | e.g. `🙏` |
| `name` | `text` UNIQUE | plain name |
| `display_name` | `text` | `emoji + ' ' + name`, always derived |
| `focus` | `text` enum | `sprint` \| `steady` \| `simmer` \| `dormant` — effort level |
| `focus_icon` | `text` | derived: 🔵/🟢/🟡/⚪️ |
| `timeline` | `text` nullable | free text: "lifelong", "Spring 2027" |
| `story` | `text` nullable | markdown body describing the goal |
| `sort_order` | `integer` default 0 | position within same focus level |
| `created_at` | `text` | ISO date `YYYY-MM-DD` |
| `updated_at` | `text` | ISO timestamp |

**Sorting:** goals always sort by focus level first (`sprint=0, steady=1, simmer=2, dormant=3`), then by `sort_order` ascending.

---

## `initiatives`

A project or campaign that lives under a goal. An initiative groups related tasks.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `emoji` | `text` | e.g. `📿` |
| `name` | `text` UNIQUE | |
| `display_name` | `text` | derived |
| `goal_id` | `text` FK → `goals.id` | `ON DELETE SET NULL` |
| `status` | `text` enum | `active` \| `backlog` \| `paused` \| `completed` |
| `mission` | `text` nullable | markdown describing the initiative's purpose |
| `sort_order` | `integer` default 0 | |
| `created_at` | `text` | ISO date |
| `updated_at` | `text` | ISO timestamp |

---

## `tasks`

A discrete unit of work belonging to an initiative.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `name` | `text` UNIQUE | |
| `display_name` | `text` | derived |
| `initiative_id` | `text` FK → `initiatives.id` | `ON DELETE SET NULL` |
| `status` | `text` enum | `pending` \| `assigned` \| `in-progress` \| `done` \| `blocked` \| `cancelled` |
| `objective` | `text` | what this task accomplishes (required) |
| `summary` | `text` nullable | filled on completion (or used for block reason) |
| `slot_id` | `text` FK → `schedule_slots.id` | `ON DELETE SET NULL` — which schedule slot this is assigned to |
| `sort_order` | `integer` default 0 | |
| `created_at` | `text` | ISO date |
| `updated_at` | `text` | ISO timestamp |
| `completed_at` | `text` nullable | ISO timestamp set when status → `done` |

---

## `task_requirements`

Checklist items that must all be completed before a task can be marked done.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `task_id` | `text` FK → `tasks.id` | `ON DELETE CASCADE` |
| `description` | `text` | requirement text |
| `completed` | `integer` boolean | default `false` |
| `sort_order` | `integer` | default 0, determines display order |

**Enforcement:** `POST /api/tasks/:id/done` will 400 if any requirement is unchecked.

---

## `task_tests`

Verification steps / acceptance criteria for a task.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `task_id` | `text` FK → `tasks.id` | `ON DELETE CASCADE` |
| `description` | `text` | test description |
| `passed` | `integer` boolean | default `false` |
| `sort_order` | `integer` | default 0 |

---

## `task_outputs`

Artifacts produced by a task (files, URLs, Obsidian wikilinks, etc.).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `task_id` | `text` FK → `tasks.id` | `ON DELETE CASCADE` |
| `label` | `text` | display name or link text |
| `url` | `text` nullable | optional file path, URL, or wikilink |
| `created_at` | `text` | ISO timestamp |

---

## `week_plans`

Represents a generated weekly schedule. One row per week.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `week_start` | `text` UNIQUE | `YYYY-MM-DD` (Sunday) |
| `week_end` | `text` | `YYYY-MM-DD` (Saturday) |
| `generated_at` | `text` | ISO timestamp |
| `sprint_slots` | `integer` | count of slots allocated to sprint goals |
| `steady_slots` | `integer` | count of slots allocated to steady goals |
| `simmer_slots` | `integer` | count of slots allocated to simmer goals |
| `fixed_slots` | `integer` | count of maintenance/planning slots |
| `flex_slots` | `integer` | count of unallocated flex slots |

---

## `schedule_slots`

Individual 2-hour time blocks within a week plan. 84 slots per week (12 slots/day × 7 days).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `week_plan_id` | `text` FK → `week_plans.id` | `ON DELETE CASCADE` |
| `date` | `text` | `YYYY-MM-DD` |
| `time` | `text` | `HH:00` (00, 02, 04 … 22) |
| `datetime` | `text` | `YYYY-MM-DDTHH:00` — used for sorting/querying |
| `type` | `text` enum | `maintenance` \| `planning` \| `task` \| `brief` \| `flex` |
| `status` | `text` enum | `pending` \| `in-progress` \| `done` \| `skipped` |
| `task_id` | `text` nullable | task assigned to this slot (no FK constraint) |
| `goal_id` | `text` FK → `goals.id` | `ON DELETE SET NULL` — goal allocation for unassigned slots |
| `note` | `text` nullable | completion note or skip reason |
| `day_of_week` | `text` | `Monday`, `Tuesday`, etc. |

---

## `week_goal_allocations`

Per-goal slot targets within a week plan. Tracks how many slots were budgeted and assigned per goal.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `week_plan_id` | `text` FK → `week_plans.id` | `ON DELETE CASCADE` |
| `goal_id` | `text` FK → `goals.id` | `ON DELETE CASCADE` |
| `target_slots` | `integer` | how many slots budgeted for this goal this week |
| `assigned_slots` | `integer` default 0 | how many slots have actually been assigned tasks |

---

## Relationships Overview

```
goals
  └── initiatives (goal_id → goals.id, SET NULL)
        └── tasks (initiative_id → initiatives.id, SET NULL)
              ├── task_requirements (task_id → tasks.id, CASCADE)
              ├── task_tests        (task_id → tasks.id, CASCADE)
              └── task_outputs      (task_id → tasks.id, CASCADE)

week_plans
  ├── schedule_slots       (week_plan_id → week_plans.id, CASCADE)
  └── week_goal_allocations (week_plan_id → week_plans.id, CASCADE)
```

**Delete behavior:** deleting a goal hard-deletes its initiatives and their tasks in a transaction (service-level cascade). The FK `ON DELETE SET NULL` is a safety net for orphaned references; the service never relies on it alone.
