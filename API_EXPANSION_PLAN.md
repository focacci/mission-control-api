# API Expansion Plan — Full CRUD, MCP Parity, Agent Chat Proxy

> Additive plan (not a rewrite) that closes the gap between iOS features and the
> API. Three tracks, independently shippable. Dated 2026-04-23.
>
> Target implementer: a fresh coding agent with access to this repo. Each track
> lists concrete schemas, routes, MCP tools, and PR-sized slices. Follow
> [CLAUDE.md](CLAUDE.md) — every code change updates the matching `.md` doc
> (SCHEMAS, ROUTES, SERVICES, TYPES, README).

## Contents

- [1. Goals & Non-Goals](#1-goals--non-goals)
- [2. Current Gap Summary](#2-current-gap-summary)
- [3. Track A — Domain Gap Fills](#3-track-a--domain-gap-fills)
  - [3.1 Profile](#31-profile)
  - [3.2 Context Groups & Pinned Contexts](#32-context-groups--pinned-contexts)
  - [3.3 Briefings](#33-briefings)
- [4. Track B — MCP Parity](#4-track-b--mcp-parity)
- [5. Track C — Agent Chat Proxy (Phase 2)](#5-track-c--agent-chat-proxy-phase-2)
- [6. Cross-Cutting Conventions](#6-cross-cutting-conventions)
- [7. PR-Sized Execution Slices](#7-pr-sized-execution-slices)
- [8. Acceptance Criteria](#8-acceptance-criteria)
- [9. Out of Scope](#9-out-of-scope)

---

## 1. Goals & Non-Goals

Three goals stated by the product owner:

1. **Full CRUD** — every iOS-visible entity has REST CRUD in the API.
2. **MCP server parity** — every REST action has a matching MCP tool action, so
   an agent can do anything the user can.
3. **Agent chat proxy** — the API owns the agent loop (streaming, tool events,
   persistence), not a subprocess.

**Non-goals:** multi-user auth, external agents (non-Intella-owned), mobile
push notifications, encryption at rest. Faith/Health/Plans views remain
client-only unless a concrete server-state need surfaces.

## 2. Current Gap Summary

Verified against the repo on 2026-04-23 (see [ROUTES.md](src/routes/ROUTES.md),
[server.ts](src/mcp/server.ts), and
[ChatContextStore.swift](../mission-control-ios/MissionControl/Views/FloatingChat/ChatContextStore.swift)).

| Area | REST | MCP tool | Notes |
|---|---|---|---|
| Goals, Initiatives, Tasks, Requirements+Tests, Agent Assignments | ✅ | ✅ | Full coverage |
| Schedule, Slot Outputs, Board | ✅ | ✅ | Full coverage |
| Agents | ✅ | ❌ | REST exists; no MCP tool |
| Chat sessions / messages | ✅ (read+delete) | ❌ | No MCP tool |
| Invocations | ✅ (read) | ❌ | No MCP tool |
| **Profile** (traits, habits, places, activities, purpose) | ❌ | ❌ | Client-only today |
| **Context Groups + Pinned Contexts** | ❌ | ❌ | Lives only in `ChatContextStore` |
| **Briefings** (morning/afternoon/evening) | ❌ | ❌ | `BriefsView` renders days with no data source |
| Chat streaming / cancel / activity | ❌ | n/a | Phase 2 not shipped |

Tracks A (domain) and B (MCP) are additive and can ship in parallel. Track C
supersedes [PHASE_2_API_PLAN.md](PHASE_2_API_PLAN.md) as the current plan for
the agent loop; we keep that doc as-is and treat it as the authoritative design.

---

## 3. Track A — Domain Gap Fills

For each new domain: schema → service → route → types → MCP tool → docs. All
writes use nanoid IDs, ISO timestamps, hard-delete cascades in synchronous
transactions. Follow the patterns already in
[goals.service.ts](src/services/goals.service.ts) and
[requirements.service.ts](src/services/requirements.service.ts).

### 3.1 Profile

**Purpose.** Persist the long-running picture the agent has built of the user:
tendencies, strengths/weaknesses, favorite places/activities, purpose behind
goals. Drives the Profile tab and grounds chats with `.profile(section:)`.

**Shape.** Single-user system, so use a **sections + entries** pattern rather
than free-form markdown. Keeps the agent's writes structured and diffable.

**Schema** (`src/db/schema.ts`):

```ts
export const profileSections = sqliteTable('profile_sections', {
  id: text('id').primaryKey(),                  // 'overview'|'traits'|'habits'|'places'|'activities'|'purpose'
  label: text('label').notNull(),
  icon: text('icon').notNull(),
  summary: text('summary'),                     // optional narrative paragraph
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const profileEntries = sqliteTable('profile_entries', {
  id: text('id').primaryKey(),
  sectionId: text('section_id')
    .notNull()
    .references(() => profileSections.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),               // "Early riser", "Loves Lake Tahoe", etc.
  detail: text('detail'),                       // optional expanded text
  confidence: text('confidence', { enum: ['observed', 'inferred', 'stated'] })
    .notNull()
    .default('observed'),
  source: text('source'),                       // free text: 'chat', 'manual', invocation id
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

**Seed.** Seed the six sections from [ProfileView.swift](../mission-control-ios/MissionControl/Views/Profile/ProfileView.swift)
in [src/db/seed.ts](src/db/seed.ts).

**Routes** (`src/routes/profile.routes.ts`):

| Method | Path | Body / Query | Response |
|---|---|---|---|
| `GET` | `/api/profile` | — | `{ sections: (ProfileSection & { entries: ProfileEntry[] })[] }` |
| `GET` | `/api/profile/sections/:sectionId` | — | `ProfileSection & { entries: ProfileEntry[] }` |
| `PATCH` | `/api/profile/sections/:sectionId` | `{ summary?: string \| null }` | `ProfileSection` |
| `POST` | `/api/profile/sections/:sectionId/entries` | `{ label, detail?, confidence?, source? }` | `201 ProfileEntry` |
| `PATCH` | `/api/profile/entries/:entryId` | `{ label?, detail?, confidence?, source?, sortOrder? }` | `ProfileEntry` |
| `DELETE` | `/api/profile/entries/:entryId` | — | `204` |

**Why** a single `/api/profile` aggregate read: the Profile tab always renders
all sections together; one round trip is simpler than six.

**Service** (`src/services/profile.service.ts`): `getProfile`,
`getSection(sectionId)`, `updateSection(sectionId, body)`,
`addEntry(sectionId, body)`, `updateEntry(entryId, body)`, `deleteEntry(entryId)`.
Throw `AppError(404)` for unknown section/entry ids. Sort sections by
`sortOrder`, entries by `sortOrder` then `createdAt`.

**iOS migration.** [ProfileView.swift](../mission-control-ios/MissionControl/Views/Profile/ProfileView.swift)
subsections (`OverviewSection`, `TraitsSection`, …) read from a new
`ProfileViewModel` hitting `APIClient.profile()`. Keep `ProfileSection` enum as
display-only; the id string maps to `sectionId` on the API.

### 3.2 Context Groups & Pinned Contexts

**Purpose.** Persist what currently lives in
[ChatContextStore.swift:154-177](../mission-control-ios/MissionControl/Views/FloatingChat/ChatContextStore.swift#L154-L177)
— the user's saved groups of `ChatContextKind` bundles and their pinned
contexts — so they survive app restarts, sync between device/watch, and can be
read/written by the agent.

**Shape.** A context reference is `(contextType: string, contextId: string | null)`
plus a display snapshot (label, icon) captured at save time so the UI can render
without resolving the ref. That mirrors the fields already persisted on
`chat_sessions`.

**Schema:**

```ts
export const pinnedContexts = sqliteTable('pinned_contexts', {
  id: text('id').primaryKey(),
  contextType: text('context_type').notNull(),        // matches ChatContextKind.contextType
  contextId: text('context_id'),                      // nullable for non-entity kinds
  label: text('label').notNull(),                     // snapshot
  icon: text('icon').notNull(),                       // SF Symbol name
  typeName: text('type_name').notNull(),              // human label for "kind"
  payload: text('payload'),                           // JSON blob for extras (section names, date, mode, etc.)
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const contextGroups = sqliteTable('context_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('point.3.connected.trianglepath.dotted'),
  summary: text('summary'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const contextGroupMembers = sqliteTable('context_group_members', {
  id: text('id').primaryKey(),
  groupId: text('group_id')
    .notNull()
    .references(() => contextGroups.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(),
  contextId: text('context_id'),
  label: text('label').notNull(),
  icon: text('icon').notNull(),
  typeName: text('type_name').notNull(),
  payload: text('payload'),                           // JSON blob, same shape as pinned
  sortOrder: integer('sort_order').notNull().default(0),
});
```

Uniqueness is enforced in the service (not the schema) because equality on
`(contextType, contextId, payload)` can only be resolved after parsing `payload`.

**Routes** (`src/routes/contextGroups.routes.ts` — covers both aggregates):

| Method | Path | Body / Query | Response |
|---|---|---|---|
| `GET` | `/api/pinned-contexts` | — | `PinnedContext[]` |
| `POST` | `/api/pinned-contexts` | `{ contextType, contextId?, label, icon, typeName, payload? }` | `201 PinnedContext` |
| `DELETE` | `/api/pinned-contexts/:id` | — | `204` |
| `GET` | `/api/context-groups` | — | `(ContextGroup & { members: ContextGroupMember[] })[]` |
| `GET` | `/api/context-groups/:id` | — | `ContextGroup & { members: ContextGroupMember[] }` |
| `POST` | `/api/context-groups` | `{ name, icon?, summary?, members?: NewMember[] }` | `201 ContextGroup & { members }` |
| `PATCH` | `/api/context-groups/:id` | `{ name?, icon?, summary?, sortOrder? }` | `ContextGroup` |
| `DELETE` | `/api/context-groups/:id` | — | `204` |
| `POST` | `/api/context-groups/:id/members` | `{ contextType, contextId?, label, icon, typeName, payload? }` | `201 ContextGroupMember` |
| `DELETE` | `/api/context-groups/:groupId/members/:memberId` | — | `204` |

Pinned-contexts is a flat list (no group). Members use POST/DELETE (not
PATCH) — a member is either in or out; reordering comes via `sortOrder` in a
PATCH, which we can add later if the UI needs it.

**iOS migration.** [ChatContextStore.swift](../mission-control-ios/MissionControl/Views/FloatingChat/ChatContextStore.swift)
keeps its in-memory cache but `load()` on sheet open hits the API; mutations
(`togglePinned`, `createGroup`, `toggleKind`) call the API and update the cache
on success. Map `ChatContextKind` enum cases to `(contextType, contextId,
payload)` via a small codec next to the existing `contextType`/`contextId`
properties — the `payload` captures the cases that currently lose data in those
two properties (`.schedule(date, mode)`, `.brief(kind, date)`, `.featureList`,
`.plans(section)`, `.timeSlot(time, dayLabel)`, etc.).

### 3.3 Briefings

**Purpose.** Power [BriefsView.swift](../mission-control-ios/MissionControl/Views/Briefs/BriefsView.swift)
with real data: morning, afternoon, evening briefs per day. Each brief is a
structured snapshot of recent activity the agent generated (or a stub the user
wrote manually).

**Shape.** `briefs` keyed by `(date, kind)` with a generated body and a JSON
blob of referenced entities (task ids, slot ids) the UI can deep-link to.

**Schema:**

```ts
export const briefs = sqliteTable('briefs', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),                       // YYYY-MM-DD
  kind: text('kind', { enum: ['morning', 'afternoon', 'evening'] }).notNull(),
  status: text('status', { enum: ['pending', 'generating', 'ready', 'error'] })
    .notNull()
    .default('pending'),
  title: text('title'),
  body: text('body'),                                 // markdown
  references: text('references'),                     // JSON: { tasks: string[], slots: string[], initiatives: string[] }
  invocationId: text('invocation_id'),                // link to the agent_invocations row that produced this
  generatedAt: text('generated_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
// Add a unique index on (date, kind) to dedupe.
```

**Routes** (`src/routes/briefs.routes.ts`):

| Method | Path | Body / Query | Response |
|---|---|---|---|
| `GET` | `/api/briefs` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both required) | `Brief[]` ordered by `date desc, kind order` |
| `GET` | `/api/briefs/:id` | — | `Brief` |
| `GET` | `/api/briefs/by-date/:date` | — | `{ date, morning: Brief \| null, afternoon: Brief \| null, evening: Brief \| null }` |
| `POST` | `/api/briefs/generate` | `{ date, kind }` | `202 { briefId, invocationId }` — enqueues a generation run |
| `PATCH` | `/api/briefs/:id` | `{ title?, body?, status? }` | `Brief` — for manual edits |
| `DELETE` | `/api/briefs/:id` | — | `204` |

`POST /generate` kicks the agent loop (Track C) with `trigger='brief'` and
returns the invocation id. Until Track C lands, the handler returns `501` with
a clear message; the other brief routes are usable without it (manual create
via PATCH on a stubbed row, or the agent can write via the MCP tool below).

**iOS migration.** Replace `DayBriefsSection` data source with
`APIClient.briefsForDate(date)`. Keep `DailyBrief` enum (`.morning`,
`.afternoon`, `.evening`) as a display-only identifier that maps to `kind`.

---

## 4. Track B — MCP Parity

Rule: every REST action has a matching MCP tool action. Add these tools to
[src/mcp/server.ts](src/mcp/server.ts) following the existing
"action-discriminator per domain aggregate" pattern (keeps tool count low for
local LLMs).

### New MCP tools

| Tool | Actions | Notes |
|---|---|---|
| `agents` | `list, get, create, update, delete, repair` | Mirrors [agents.routes.ts](src/routes/agents.routes.ts). `update` accepts `systemPrompt` only (with `null` → clear). |
| `chat` | `list_sessions, get_session, create_session, list_messages, delete_session, send_message` | `send_message` maps to `POST /api/chat` — the only write path; everything else is reads/deletes. Once Track C ships, add `cancel_invocation` via the `invocations` tool. |
| `invocations` | `list, get, cancel` | `cancel` lands with Track C. Until then, `cancel` throws `AppError(501)`. |
| `profile` | `get, get_section, update_section, add_entry, update_entry, delete_entry` | Returns full profile by default so the agent can reason over all sections without multiple calls. |
| `context_groups` | `list_pinned, pin, unpin, list_groups, get_group, create_group, update_group, delete_group, add_member, remove_member` | Tool-level grouping for both pinned and groups (they're the same conceptual domain). |
| `briefings` | `list, get, get_by_date, generate, update, delete` | `generate` returns `{ briefId, invocationId }`; agent can poll via `get`. |

### Implementation notes

- Each new tool is a coarse-grained aggregate with an `action` discriminator,
  matching the existing shape in [server.ts:18-209](src/mcp/server.ts#L18).
- Dispatch helpers live in the same file. When the file grows past ~900 lines,
  split into `src/mcp/tools/{goals,tasks,…}.ts` with a single `TOOLS` registry —
  defer that refactor until needed.
- All tool calls go through the same `AppError` → JSON envelope.
- The `board` tool stays the agent's "look first" entry point. Add
  `briefings.get_by_date` as a complementary read for the brief generator flow.

### MCP-only helpers (optional, ship after Track A)

Consider exposing a coarse `search` tool that takes `{ query, domains?: string[] }`
and runs a LIKE against `name`/`label`/`title`/`body` across tasks, goals,
initiatives, profile entries, and brief bodies. Cheap to build, high-leverage
for the agent. Mark out of scope for the first pass.

---

## 5. Track C — Agent Chat Proxy (Phase 2)

This track is already designed in [PHASE_2_API_PLAN.md](PHASE_2_API_PLAN.md)
(dated 2026-04-21) and [CONTROL_LAYER_PLAN.md §5](CONTROL_LAYER_PLAN.md#5-phase-2--in-process-agent-loop).
The plan is sound — no changes. Summary of what a fresh agent delivers:

1. **Gateway WS client** — `src/agent/gatewayClient.ts`, ~200 LOC, modeled on
   `openclaw/src/gateway/client.ts` (connect, handshake, req/res, event
   subscribe, reconnect).
2. **Runner** — `src/agent/runner.ts`: calls `agent` RPC, subscribes to
   `lifecycle`/`assistant`/`tool` event streams for its `runId`, translates to
   the `AgentEvent` union (§5 of PHASE_2 doc), writes to `chat_messages` +
   `tool_call_log` + `agent_invocations`.
3. **MCP bridge** — `src/agent/mcpBridge.ts`: mounts the in-process MCP server
   (already built in [src/mcp/server.ts](src/mcp/server.ts)) as the tool
   provider for the runner. No stdio subprocess.
4. **SSE route** — `POST /api/chat/stream` (new) emits
   `session_started | text_delta | tool_use | tool_result | message_complete | done | error | fatal`.
5. **Cancel route** — `POST /api/invocations/:id/cancel` calls
   `sessions.abort({ sessionKey })` and marks the invocation `cancelled`.
6. **Activity route** — `GET /api/chat/sessions/:id/activity` returns the
   interleaved `messages + toolCalls` timeline for resuming a past session.
7. **Delete** [src/services/chat.service.ts](src/services/chat.service.ts)
   (the `openclaw agent --json` subprocess path) once `POST /api/chat` is
   rewired to the runner.
8. **Update docs** — [ROUTES.md](src/routes/ROUTES.md),
   [SERVICES.md](src/services/SERVICES.md), [SCHEMAS.md](src/db/SCHEMAS.md)
   (no schema change; `tool_call_log.summary` already exists).

Track C unblocks the `briefings.generate` and `invocations.cancel` MCP actions
from Track B.

---

## 6. Cross-Cutting Conventions

- IDs: `nanoid` strings via `generateId()` in
  [src/types/index.types.ts](src/types/index.types.ts).
- Timestamps: `createdAt` = ISO date (`YYYY-MM-DD`); `updatedAt` / `completedAt` /
  `generatedAt` = full ISO timestamp.
- Hard deletes only, in a synchronous SQLite transaction, with explicit cascade
  logic even when `onDelete: 'cascade'` is declared (defense-in-depth for
  cross-table invariants).
- Services throw `AppError(statusCode, message, details?)`; the global Fastify
  handler renders JSON.
- Zod `.parse()` in the route handler before calling the service. Zod schemas
  live in [src/types/index.types.ts](src/types/index.types.ts).
- Docs are ground truth. After **any** code change, update the matching
  `SCHEMAS.md` / `ROUTES.md` / `SERVICES.md` / `TYPES.md` / `README.md`
  sections per [CLAUDE.md](CLAUDE.md).

---

## 7. PR-Sized Execution Slices

Each slice is reviewable in isolation. Tracks A and B can interleave; Track C
follows [PHASE_2_API_PLAN.md §9](PHASE_2_API_PLAN.md#9-pr-sized-execution-slices).

### Track A

1. **A1 — Profile.** Schema + seed + service + routes + types + docs. No iOS
   changes yet; just server.
2. **A2 — Profile MCP tool.** Adds `profile` tool to [server.ts](src/mcp/server.ts).
3. **A3 — Context Groups & Pinned.** Schema + service + routes + types + docs.
4. **A4 — Context Groups MCP tool.**
5. **A5 — Briefings (data layer).** Schema + service + routes (all except
   `generate`) + types + docs. `generate` returns `501` until Track C ships.
6. **A6 — Briefings MCP tool.** Same caveat on `generate`.

### Track B (independent of iOS)

7. **B1 — Agents MCP tool.**
8. **B2 — Chat/Conversations MCP tool.**
9. **B3 — Invocations MCP tool** (read-only until Track C).

### Track C

10+. Follow [PHASE_2_API_PLAN.md §9](PHASE_2_API_PLAN.md#9-pr-sized-execution-slices)
     verbatim. When it lands, revisit A6 (`briefings.generate`) and B3
     (`invocations.cancel`) to wire them up.

### iOS wiring (optional, after each A slice)

The API changes are independently shippable. iOS migration PRs can follow:

- iOS-A1: Profile view model hits `/api/profile`.
- iOS-A3: `ChatContextStore` load/save hits `/api/pinned-contexts` and
  `/api/context-groups`.
- iOS-A5: `BriefsView` reads from `/api/briefs/by-date/:date`.

---

## 8. Acceptance Criteria

- **Track A** — every iOS page that currently holds state in a `@State` or
  `@Observable` store reads/writes to the API. Kill the app, relaunch, state
  survives.
- **Track B** — calling `ListTools` over MCP returns tools covering every
  entity in [SCHEMAS.md](src/db/SCHEMAS.md) plus `board` and `health`. Every
  REST mutation has a matching tool action.
- **Track C** — `POST /api/chat/stream` emits the event vocabulary from
  [PHASE_2_API_PLAN.md §5](PHASE_2_API_PLAN.md#5-target-event-contract-authoritative).
  Tool calls the agent makes via MCP are persisted to `tool_call_log` in
  realtime and visible in `GET /api/invocations/:id` before the turn ends.
- **Docs** — `ROUTES.md`, `SCHEMAS.md`, `SERVICES.md`, `TYPES.md`, `README.md`
  all reflect the shipped state at each PR boundary.

---

## 9. Out of Scope

- Auth / multi-user. `INTELLA_AUTH_TOKEN` shared-secret gate is tracked in
  [CONTROL_LAYER_PLAN.md §8](CONTROL_LAYER_PLAN.md#8-cross-cutting-concerns) —
  orthogonal to this plan.
- Faith, Health, Plans, FeatureList server state. Revisit per-surface when a
  concrete need surfaces.
- External MCP server mounts on per-agent basis.
- Push notifications for brief-ready events.
- Search tool (mentioned as optional in §4).
