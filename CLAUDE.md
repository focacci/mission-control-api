# Claude Instructions — Mission Control API

## Documentation Maintenance

After **any code change**, update the documentation files that are affected:

| Changed file(s) | Update this doc |
|----------------|-----------------|
| `src/db/schema.ts` | [src/db/SCHEMAS.md](src/db/SCHEMAS.md) |
| `src/routes/*.routes.ts` | [src/routes/ROUTES.md](src/routes/ROUTES.md) |
| `src/services/*.service.ts` | [src/services/SERVICES.md](src/services/SERVICES.md) |
| `src/types/index.types.ts` | [src/types/TYPES.md](src/types/TYPES.md) |
| Any of the above | [README.md](README.md) if the change affects the overview, install steps, or API summary |

Keep documentation **accurate to the actual code**, not to the BLUEPRINT. The BLUEPRINT is a design document; the markdown docs in each directory are ground truth for the running implementation.

### What to update

- **SCHEMAS.md**: add/remove/modify table or column entries when the Drizzle schema changes
- **ROUTES.md**: reflect any new routes, removed routes, changed request/response shapes, or changed query params
- **SERVICES.md**: update function signatures, parameter descriptions, and behavior notes when service logic changes
- **TYPES.md**: update Zod schema docs, inferred type table, constants, and utility function descriptions

Do not update docs for things that haven't changed. Only touch the sections relevant to your edit.

### Table of contents

Every documentation file must have a `## Contents` table of contents immediately after the H1 heading. When you add or remove a section heading, update the TOC in the same file. The TOC should cover H2 and H3 headings; H4 and deeper are optional. Use standard GitHub-flavored markdown anchor links.

---

## Project Overview

**Mission Control API** — personal productivity REST API (Fastify + TypeScript + Drizzle ORM + SQLite).

Hierarchy: **Goals → Initiatives → Tasks** (with Requirements, Tests, and Outputs as task sub-resources).

Key files:
- `src/index.ts` — Fastify bootstrap, error handler, route registration
- `src/db/schema.ts` — all Drizzle table definitions (single source of truth for DB shape)
- `src/types/index.types.ts` — Zod schemas, inferred input types, `AppError`, utility functions
- `src/routes/` — thin handlers: parse input → call service → return result
- `src/services/` — all business logic and DB queries

## Conventions

- IDs are `nanoid` strings.
- Timestamps: `createdAt` = ISO date (`YYYY-MM-DD`); `updatedAt` / `completedAt` = full ISO timestamp.
- `displayName = emoji + ' ' + name` — always derived, never manually set by callers.
- `focusIcon` is always derived from `focus` via `FOCUS_ICONS` — never stored independently.
- Deletes are **hard deletes** executed in synchronous SQLite transactions with explicit cascade logic in the service layer.
- Services throw `AppError` for expected failures; the global Fastify error handler converts them to structured JSON responses.
- Zod `.parse()` is called in route handlers — a `ZodError` surfaces as a `400` with flattened details.
