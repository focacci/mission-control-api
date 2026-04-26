# Mission Control API

Autonomous task, goal, and schedule management API. Built for personal productivity — a single-user, localhost-only service that structures work into **Goals → Initiatives → Tasks** and integrates with an Obsidian vault.

**Stack:** Fastify 5 · TypeScript · Drizzle ORM · SQLite (better-sqlite3)

---

## Contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Configure](#configure)
- [Run](#run)
- [Database](#database)
- [Health Check](#health-check)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [API Overview](#api-overview)
- [Documentation](#documentation)
- [Error Responses](#error-responses)

---

## Prerequisites

- Node.js 20+
- npm

---

## Install

```bash
npm install
```

---

## Configure

Copy `.env` and fill in your paths:

```env
PORT=3737
DB_PATH=./data/mission-control.db
VAULT_PATH=/path/to/your/obsidian/vault
WORKSPACE_PATH=/path/to/your/workspace

# OpenClaw Gateway (required for live agent runs — see PHASE_2_API_PLAN.md)
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=<shared secret from ~/.openclaw/openclaw.json>
```

`DB_PATH` is created automatically on first run if it doesn't exist. The API connects to the OpenClaw gateway on boot and reconnects automatically if the socket drops; if the gateway is unreachable, `/health` will report `gateway.connected: false` until it recovers.

### Gateway device identity

On first boot the API generates an Ed25519 keypair at `data/device-identity.json` and uses it to sign a v3 device-auth payload on every `connect` frame. The gateway auto-pairs the device and issues a scoped device token (persisted to `data/gateway-device-token.json`), which unlocks the scoped `agent` / `sessions.*` RPCs. Both files are machine-local, gitignored, and should not be shared. Delete them to force a fresh pairing.

---

## Run

### Development (hot reload)

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

The server starts on `http://localhost:3737` (or the `PORT` in your `.env`).

---

## Database

### Generate migrations after schema changes

```bash
npm run generate
```

### Apply migrations

```bash
npm run migrate
```

Migrations are stored in `drizzle/migrations/`.

### Seed from Obsidian vault

```bash
npm run seed
```

One-time import: scans your vault for goal, initiative, and task markdown files and inserts them into the database. Also seeds the six fixed profile sections (`overview`, `traits`, `habits`, `places`, `activities`, `purpose`) — required for `/api/profile` to work.

Alternatively, use the API endpoint after the server is running:

```bash
curl -X POST http://localhost:3737/api/sync/import
```

---

## Health Check

```bash
curl http://localhost:3737/health
# → {
#     "status": "ok",
#     "goals": 5,
#     "gateway": {
#       "connected": true,
#       "lastHelloAt": "2026-04-23T22:33:40.140Z",
#       "deviceTokenPresent": false
#     }
#   }
```

`gateway.connected` reflects the live state of the OpenClaw WS transport. `deviceTokenPresent` becomes `true` once the gateway issues a long-lived device token (persisted under `data/gateway-device-token.json`).

---

## Project Structure

```
src/
├── index.ts                  # Fastify bootstrap, plugin registration, error handler
├── db/
│   ├── client.ts             # Drizzle + better-sqlite3 connection (WAL mode, FK enforcement)
│   ├── schema.ts             # All Drizzle table definitions
│   └── seed.ts               # One-time Obsidian vault importer
├── routes/
│   ├── goals.routes.ts              # /api/goals/*
│   ├── initiatives.routes.ts        # /api/initiatives/*
│   ├── tasks.routes.ts              # /api/tasks/* (core CRUD + requirement creation)
│   ├── requirements.routes.ts       # /api/requirements/* (+ nested tests)
│   ├── agentAssignments.routes.ts   # /api/tasks/:taskId/agent-assignments, /api/agent-assignments/:id
│   └── schedule.routes.ts           # /api/schedule/* (+ slot outputs)
├── services/
│   ├── goals.service.ts             # Goal CRUD + cascade delete
│   ├── initiatives.service.ts       # Initiative CRUD + complete action
│   ├── tasks.service.ts             # Task CRUD + lifecycle
│   ├── requirements.service.ts      # Requirement CRUD + requirement tests
│   ├── agentAssignments.service.ts  # Agent assignment CRUD + completion
│   └── schedule.service.ts          # Week plan gen + slot lifecycle + slot outputs
└── types/
    └── index.types.ts        # Zod schemas, inferred types, AppError, utility functions
```

---

## Data Model

Work is organized in three levels:

```
Goals          — long-term areas of life/work (e.g. "🙏 Grow in Faith")
  └── Initiatives — projects/campaigns under a goal (e.g. "📿 Daily Prayer Habit")
        └── Tasks  — discrete units of work (e.g. "🙏📿 Set up morning alarm")
```

Each task can have:
- **Requirements** — checklist items that must all be checked before the task can be marked done. Each requirement owns its own **tests** (acceptance criteria / verification steps).
- **Agent Assignments** — discrete chunks of work delegated to an agent. Scheduling operates on agent assignments (not tasks): a slot links to an `agentAssignmentId`, and the outputs produced during that slot live on the slot as **slot outputs** (files, URLs, wikilinks).

### Agent control layer (Phases 1–2)

Every chat turn is persisted. The DB is the source of truth for conversations, not OpenClaw's session cache.

- `chat_sessions` groups messages by `(agentId, contextType, contextId)`.
- `chat_messages` stores each user/assistant turn in `sortOrder`.
- `agent_invocations` tracks the lifecycle of every agent run (chat, scheduled slot-start, brief generation).
- `tool_call_log` captures every MCP tool the model calls, with a one-line `summary` for the collapsed-row UI.

**Phase 2 — in-process agent loop (in progress).** The `openclaw agent` subprocess has been replaced by an in-process OpenClaw Gateway WebSocket client ([src/agent/](src/agent/)). Chat turns run through `handleChatTurn → runner.run`, which subscribes to gateway `lifecycle` / `assistant` / `tool` streams and emits `text_delta` / `tool_use` / `tool_result` / `message_complete` / `done` events. `POST /api/chat` buffers those events into a single reply for legacy clients; `POST /api/chat/stream` ships them frame-by-frame as SSE (see "Streaming chat" below). `POST /api/invocations/:id/cancel` and `GET /api/chat/sessions/:id/activity` land in subsequent slices.

See [CONTROL_LAYER_PLAN.md](CONTROL_LAYER_PLAN.md), [CONTROL_LAYER_PHASE_2_UI.md](CONTROL_LAYER_PHASE_2_UI.md), and [PHASE_2_API_PLAN.md](PHASE_2_API_PLAN.md) for full design context.

Goals have a **focus level** that controls weekly schedule allocation:

| Focus | Icon | Weekly slots |
|-------|------|-------------|
| `sprint` | 🔵 | ~30 (split across sprint goals) |
| `steady` | 🟢 | ~12 (split across steady goals) |
| `simmer` | 🟡 | ~4 (split across simmer goals) |
| `dormant` | ⚪️ | 0 — on hold |

---

## API Overview

| Resource | Base path | Docs |
|----------|-----------|------|
| Goals | `/api/goals` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Initiatives | `/api/initiatives` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Tasks | `/api/tasks` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Schedule | `/api/schedule` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Board | `/api/board` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Agents | `/api/agents` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Chat | `/api/chat`, `/api/chat/stream` (SSE) | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Conversations | `/api/chat/sessions` (+ `/activity`) | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Invocations | `/api/invocations` (+ `/:id/cancel`) | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Profile | `/api/profile` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Pinned Contexts | `/api/pinned-contexts` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Context Groups | `/api/context-groups` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| Briefings | `/api/briefs` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |

### Quick examples

```bash
# List all goals
curl http://localhost:3737/api/goals

# Create a goal
curl -X POST http://localhost:3737/api/goals \
  -H 'Content-Type: application/json' \
  -d '{ "emoji": "🙏", "name": "Grow in Faith", "focus": "steady" }'

# Create a task
curl -X POST http://localhost:3737/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Set up morning alarm",
    "initiativeId": "<id>",
    "objective": "Establish a consistent wake time",
    "requirements": ["Choose alarm time", "Test for one week"]
  }'

# Start → complete a task
curl -X POST http://localhost:3737/api/tasks/<id>/start
curl -X POST http://localhost:3737/api/requirements/<reqId>/check
curl -X POST http://localhost:3737/api/tasks/<id>/done \
  -H 'Content-Type: application/json' \
  -d '{ "summary": "Alarm set for 6am, tested for 7 days." }'
```

### Streaming chat

`POST /api/chat/stream` returns the same chat turn as `POST /api/chat`, but as a Server-Sent Events stream of `AgentEvent` frames. The first frame is always `session_started`; the last is `done` (success) or `error` with `fatal: true`. A `ping` frame is emitted every 15 seconds so mobile / proxy NATs don't drop a long silent tool call. Pre-stream validation errors return JSON `400`; mid-stream failures emit a final `error` frame and close at HTTP 200. Client disconnects do **not** cancel the in-flight invocation — the runner finalizes detached, and clients resume via the (forthcoming) activity endpoint.

```bash
curl -N -X POST http://localhost:3737/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{ "message": "Show me my board." }'
```

See `scripts/sse-stream-smoke.sh` for the full smoke harness and [src/agent/events.ts](src/agent/events.ts) for the event union.

---

## Documentation

| File | Contents |
|------|----------|
| [BLUEPRINT.md](BLUEPRINT.md) | Full system design, data model, business rules, Obsidian sync spec |
| [CONTROL_LAYER_PLAN.md](CONTROL_LAYER_PLAN.md) | Phased plan for evolving the API from an openclaw proxy into a full control layer |
| [src/db/SCHEMAS.md](src/db/SCHEMAS.md) | All table schemas with column descriptions and relationships |
| [src/routes/ROUTES.md](src/routes/ROUTES.md) | Every route, request shape, and response shape |
| [src/services/SERVICES.md](src/services/SERVICES.md) | Every service function with parameter and behavior docs |
| [src/types/TYPES.md](src/types/TYPES.md) | All Zod schemas, inferred types, constants, and utilities |

---

## Error Responses

All errors return JSON:

```json
{ "error": "Description of what went wrong", "details": {} }
```

| Scenario | Status |
|----------|--------|
| Resource not found | `404` |
| Validation failure (Zod) | `400` |
| Business rule violation (e.g. completing task with unchecked requirements) | `400` |
| State conflict (e.g. starting a cancelled task) | `409` |
| Unhandled exception | `500` |
