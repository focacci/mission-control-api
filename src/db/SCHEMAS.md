# Database Schemas

## Contents

- [`goals`](#goals)
- [`initiatives`](#initiatives)
- [`tasks`](#tasks)
- [`task_requirements`](#task_requirements)
- [`requirement_tests`](#requirement_tests)
- [`agent_assignments`](#agent_assignments)
- [`week_plans`](#week_plans)
- [`schedule_slots`](#schedule_slots)
- [`slot_outputs`](#slot_outputs)
- [`week_goal_allocations`](#week_goal_allocations)
- [`agents`](#agents)
- [`chat_sessions`](#chat_sessions)
- [`agent_invocations`](#agent_invocations)
- [`chat_messages`](#chat_messages)
- [`tool_call_log`](#tool_call_log)
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
| `status` | `text` enum | `pending` \| `in-progress` \| `done` \| `blocked` \| `cancelled` |
| `objective` | `text` | what this task accomplishes (required) |
| `summary` | `text` nullable | filled on completion (or used for block reason) |
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

## `requirement_tests`

Verification steps attached to a specific requirement. When all tests under a requirement pass, the requirement can be checked off.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `requirement_id` | `text` FK → `task_requirements.id` | `ON DELETE CASCADE` |
| `description` | `text` | test description |
| `passed` | `integer` boolean | default `false` |
| `sort_order` | `integer` | default 0 |

---

## `agent_assignments`

A chunk of task work delegated to an agent. Tasks are purely human-driven; agent assignments are the unit that gets scheduled into slots and produces outputs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `task_id` | `text` FK → `tasks.id` | `ON DELETE CASCADE` |
| `agent_id` | `text` FK → `agents.id` nullable | `ON DELETE SET NULL` |
| `name` | `text` | short title for the assignment |
| `instructions` | `text` nullable | markdown brief handed to the agent |
| `completed` | `integer` boolean | default `false` |
| `completed_at` | `text` nullable | ISO timestamp set when `completed → true` |
| `sort_order` | `integer` default 0 | |
| `created_at` | `text` | ISO timestamp |
| `updated_at` | `text` | ISO timestamp |

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
| `type` | `text` enum | `maintenance` \| `planning` \| `agent_assignment` \| `brief` \| `flex` |
| `status` | `text` enum | `pending` \| `in-progress` \| `done` \| `skipped` |
| `agent_assignment_id` | `text` nullable | agent assignment occupying this slot (no FK constraint — service-level cleanup) |
| `goal_id` | `text` FK → `goals.id` | `ON DELETE SET NULL` — goal allocation for unassigned slots |
| `note` | `text` nullable | completion note or skip reason |
| `day_of_week` | `text` | `Monday`, `Tuesday`, etc. |

---

## `slot_outputs`

Artifacts produced during a scheduled slot (files, URLs, wikilinks, notes). Outputs live on the slot, not the task — an agent assignment may produce outputs across multiple slots.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `slot_id` | `text` FK → `schedule_slots.id` | `ON DELETE CASCADE` |
| `label` | `text` | display name or link text |
| `url` | `text` nullable | optional file path, URL, or wikilink |
| `created_at` | `text` | ISO timestamp |

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

## `agents`

Local cache of OpenClaw agents managed by this API. The DB is the source of truth for reads; writes go through both the `openclaw` CLI and this table (write-through). The `POST /api/agents/sync` endpoint reconciles the table against the CLI.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | normalized name (lowercase, alphanumeric + hyphens); also the OpenClaw agent id |
| `name` | `text` | display name as reported by openclaw |
| `identity_name` | `text` nullable | `identityName` from openclaw (may differ from `name`) |
| `identity_emoji` | `text` nullable | emoji rendered in the iOS list |
| `workspace` | `text` | absolute path — usually `~/.openclaw/agents/<id>/workspace`; `SOUL.md` lives here |
| `agent_dir` | `text` | absolute path to the agent root directory |
| `model` | `text` nullable | OpenClaw model key (e.g. `github-copilot/claude-sonnet-4`) |
| `bindings` | `integer` default 0 | count of active bindings (informational) |
| `is_default` | `integer` boolean default false | default agent cannot be deleted |
| `system_prompt` | `text` nullable | mirrors the contents of `<workspace>/SOUL.md` |
| `created_at` | `text` | ISO timestamp |
| `updated_at` | `text` | ISO timestamp |

**No FKs.** Agents are independent of the goals/initiatives/tasks hierarchy.

---

## `chat_sessions`

Conversation container. Groups messages exchanged with a specific agent, optionally scoped to a view (`contextType` + `contextId`). A session survives across many agent invocations; the DB is the source of truth for the transcript (OpenClaw's own `--session-id` is no longer relied on for continuity).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `agent_id` | `text` | which agent this session is with |
| `context_type` | `text` nullable | e.g. `task`, `goal`, `slot`; null for freeform chat |
| `context_id` | `text` nullable | id of the scoped entity; null for freeform |
| `title` | `text` nullable | derived from the first user message (first 80 chars) |
| `created_at` | `text` | ISO timestamp |
| `last_message_at` | `text` | ISO timestamp — updated on every message append |

---

## `agent_invocations`

One row per agent run (chat turn, scheduled slot-start, brief generation, manual debug run). Holds lifecycle status and token accounting. Messages and tool calls reference the invocation, not vice versa — an invocation may produce zero or many messages.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `trigger` | `text` enum | `slot_start` \| `brief` \| `user_chat` \| `manual` |
| `trigger_ref_id` | `text` nullable | external entity that caused this run (e.g. `slotId`, `taskId`) |
| `agent_id` | `text` | which agent ran |
| `session_id` | `text` | chat_sessions.id (no FK — invocations outlive session deletes in some debug flows) |
| `status` | `text` enum | `running` \| `complete` \| `error` \| `timeout` \| `cancelled` — default `running` |
| `model` | `text` | model key the invocation was issued against |
| `started_at` | `text` | ISO timestamp |
| `ended_at` | `text` nullable | ISO timestamp when the invocation resolved |
| `error` | `text` nullable | error message on failure |
| `tokens_in` | `integer` default 0 | prompt tokens billed to this invocation |
| `tokens_out` | `integer` default 0 | completion tokens |

---

## `chat_messages`

Ordered turns within a session. Assistant messages link back to the `agent_invocations` row that produced them; user messages carry a `null` invocation_id until the following agent run begins.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | nanoid |
| `session_id` | `text` FK → `chat_sessions.id` | `ON DELETE CASCADE` |
| `invocation_id` | `text` nullable | `agent_invocations.id` for assistant turns; null for user turns |
| `role` | `text` enum | `user` \| `assistant` \| `system` |
| `content` | `text` | final rendered text — partial stream deltas are not persisted |
| `sort_order` | `integer` | monotonic per-session (starts at 0) |
| `created_at` | `text` | ISO timestamp |

---

## `tool_call_log`

Structured record of every tool the model called during an invocation (primarily Intella MCP tools). `id` uses Anthropic's `tool_use_id` so it's stable across correlating events. Populated in Phase 2 when the in-process runner replaces the openclaw subprocess.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | Anthropic tool_use_id |
| `message_id` | `text` FK → `chat_messages.id` | `ON DELETE CASCADE` |
| `invocation_id` | `text` | denormalized for fast per-invocation queries |
| `tool_name` | `text` | e.g. `board`, `tasks.complete` |
| `input` | `text` | JSON-encoded call arguments |
| `output` | `text` nullable | JSON-encoded tool result; null until resolved |
| `is_error` | `integer` boolean | default `false` |
| `started_at` | `text` | ISO timestamp |
| `ended_at` | `text` nullable | ISO timestamp when the result arrived |
| `duration_ms` | `integer` nullable | populated on resolution |

---

## Relationships Overview

```
goals
  └── initiatives (goal_id → goals.id, SET NULL)
        └── tasks (initiative_id → initiatives.id, SET NULL)
              ├── task_requirements (task_id → tasks.id, CASCADE)
              │     └── requirement_tests (requirement_id → task_requirements.id, CASCADE)
              └── agent_assignments (task_id → tasks.id, CASCADE; agent_id → agents.id, SET NULL)

week_plans
  ├── schedule_slots       (week_plan_id → week_plans.id, CASCADE)
  │     └── slot_outputs    (slot_id → schedule_slots.id, CASCADE)
  │     (agent_assignment_id is a soft link — no FK)
  └── week_goal_allocations (week_plan_id → week_plans.id, CASCADE)

chat_sessions
  └── chat_messages (session_id → chat_sessions.id, CASCADE)
        └── tool_call_log (message_id → chat_messages.id, CASCADE)

agent_invocations (soft link via session_id / trigger_ref_id — no FK)
```

**Delete behavior:** deleting a goal hard-deletes its initiatives, tasks, requirements, requirement tests, and agent assignments in a transaction (service-level cascade). Schedule slots that referenced deleted agent assignments are cleared back to `flex` slots with `agent_assignment_id = null`. The FK `ON DELETE SET NULL` / `CASCADE` settings are safety nets; the services never rely on them alone.
