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
```

`DB_PATH` is created automatically on first run if it doesn't exist.

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

One-time import: scans your vault for goal, initiative, and task markdown files and inserts them into the database.

Alternatively, use the API endpoint after the server is running:

```bash
curl -X POST http://localhost:3737/api/sync/import
```

---

## Health Check

```bash
curl http://localhost:3737/health
# → { "status": "ok", "goals": 5 }
```

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
│   ├── goals.routes.ts       # /api/goals/*
│   ├── initiatives.routes.ts # /api/initiatives/*
│   └── tasks.routes.ts       # /api/tasks/* (including requirements, tests, outputs)
├── services/
│   ├── goals.service.ts      # Goal CRUD + cascade delete
│   ├── initiatives.service.ts # Initiative CRUD + complete action
│   └── tasks.service.ts      # Task CRUD + lifecycle + sub-resources
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
- **Requirements** — checklist items that must all be checked before the task can be marked done
- **Tests** — acceptance criteria / verification steps
- **Outputs** — artifacts produced (files, URLs, wikilinks)

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
| Agents | `/api/agents` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |

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
curl -X POST http://localhost:3737/api/tasks/<id>/requirements/<reqId>/check
curl -X POST http://localhost:3737/api/tasks/<id>/done \
  -H 'Content-Type: application/json' \
  -d '{ "summary": "Alarm set for 6am, tested for 7 days." }'
```

---

## Documentation

| File | Contents |
|------|----------|
| [BLUEPRINT.md](BLUEPRINT.md) | Full system design, data model, business rules, Obsidian sync spec |
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
