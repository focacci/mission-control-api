# Slot Runner Plan

Self-contained spec for a clean agent session. Single repo:
- `/Users/michaelfocacci/dev/Intella/mission-control-api/` (Fastify + Drizzle + SQLite)

## Contents
- [Motivation](#motivation)
- [Behavior](#behavior)
- [Concurrency & Failure Model](#concurrency--failure-model)
- [Schema Change](#schema-change)
- [Types (Zod)](#types-zod)
- [Service Layer](#service-layer)
- [Slot Runner Module](#slot-runner-module)
- [Tick Loop](#tick-loop)
- [Bootstrap Wiring](#bootstrap-wiring)
- [Prompt Template](#prompt-template)
- [Event → Output-Step Mapping](#event--output-step-mapping)
- [Routes](#routes)
- [Docs to Update](#docs-to-update)
- [Execution Order](#execution-order)
- [Verification](#verification)
- [Out of Scope](#out-of-scope)

---

## Motivation

The schedule layer already produces `schedule_slots` with a `datetime` and an optional `agentAssignmentId`. Today nothing fires when a slot's time arrives — slots only flip to `done` via manual user action. We need an in-process runner that:

1. Wakes up periodically (60s tick).
2. Finds slots whose `datetime <= now`, `status == 'pending'`, `agentAssignmentId != null`.
3. For each due slot: marks it `in-progress`, builds a prompt from the Agent Assignment, dispatches the agent loop, captures the run as an **Agent Output** (header + steps), and on success marks the slot `done` and the Agent Assignment `done`.

The persistence side of Agent Outputs is already shipped (see [AGENT_OUTPUTS_PLAN.md](./AGENT_OUTPUTS_PLAN.md), [src/services/agentOutputs.service.ts](./src/services/agentOutputs.service.ts)). What's missing is the production write path — the thing that creates an Agent Output, streams runner events into its steps, and closes it out.

Linked Contexts / Linked Context Groups / context-aware prompts are deferred — see [Out of Scope](#out-of-scope).

---

## Behavior

Per tick (every 60 seconds):

1. **Query** `schedule_slots` where `datetime <= now()` AND `status = 'pending'` AND `agentAssignmentId IS NOT NULL`. Order by `datetime ASC` so older slots fire first.
2. For each row, run the slot **sequentially** (not in parallel). One slot at a time keeps gateway load bounded and avoids interleaved token-cap races.
3. Per slot:
   1. Re-load the slot inside a transaction; bail if its status is no longer `pending` (another tick or a manual update beat us). Otherwise, set `status = 'in-progress'`. This is the **claim**.
   2. Load the Agent Assignment. If missing or already `done`, write a `failAgentOutput` for trace and skip.
   3. `createAgentOutput(agentAssignmentId, { agentId, input, model })` — opens a `running` Agent Output. `input` is the rendered prompt (see [Prompt Template](#prompt-template)).
   4. Drive `runner.run()` with an `onEvent` handler that maps live events → `appendAgentOutputStep` calls (see [Event → Output-Step Mapping](#event--output-step-mapping)).
   5. On runner resolve: `completeAgentOutput(outputId, { response, tokensIn, tokensOut })`, then transition the slot → `done` and the Agent Assignment → `done`.
   6. On runner reject: `failAgentOutput(outputId, { error, status: 'error'|'cancelled' })`. **Slot stays `in-progress`**, AA stays in its prior status. Manual intervention required — see [Concurrency & Failure Model](#concurrency--failure-model) for rationale.

Non-blocking: a tick that's still draining a slot **never overlaps** with the next tick. The tick loop holds an `isRunning` flag and skips re-entry.

---

## Concurrency & Failure Model

- **At most one slot in flight.** The tick loop is serialized; the next tick is skipped until the current iteration drains. Simpler than per-slot mutexes and eliminates any risk of double-firing the same slot.
- **Status transitions form the lock.** A slot is "claimed" the moment its status flips to `in-progress`. The tick query filters `status = 'pending'`, so a claimed slot can't be re-picked even by an external client racing through the schedule API. The claim happens inside an SQLite transaction with a re-read so two ticks running in quick succession (e.g. on cold boot) can't both claim.
- **No automatic retry.** A failed slot stays `in-progress` and its Agent Output stays `error`. Retrying without bound on gateway flakes is worse than having the user notice. Future work can add a retry budget; out of scope here.
- **Time-cap drift.** A long-running slot may exceed its 2-hour window. That's fine — the tick keeps going, and the *next* due slot fires after the current one finishes. Slots are not currently bound to wall-clock duration.
- **Agent unavailable.** If the assignment has no `agentId`, fall back to the orchestrator default (`'intella'`) — see [chatOrchestrator.ts](./src/agent/chatOrchestrator.ts) for the constant.

---

## Schema Change

One column add. Edit [src/db/schema.ts](./src/db/schema.ts):

```ts
export const scheduleSlots = sqliteTable('schedule_slots', {
  // ...existing columns...
  extraPrompt: text('extra_prompt'),
});
```

Generate + apply migration:

```bash
bun run generate   # or: npx drizzle-kit generate
bun run migrate    # or: npx drizzle-kit migrate
```

There is **no** schema work for linked contexts in this plan — defer to a follow-up.

---

## Types (Zod)

Edit [src/types/index.types.ts](./src/types/index.types.ts):

1. Extend `UpdateSlotSchema` with an optional `extraPrompt: z.string().nullable().optional()`.
2. Re-export the inferred type if it's already exported (keep parity with the rest of the file).

No new top-level schemas. The slot runner doesn't expose any new HTTP input.

---

## Service Layer

Edit [src/services/schedule.service.ts](./src/services/schedule.service.ts):

- `updateSlot` already pattern-matches present keys onto the row. Extend it to accept `extraPrompt`:
  ```ts
  if ('extraPrompt' in input) updates.extraPrompt = input.extraPrompt ?? null;
  ```
- Add a helper used only by the slot runner (export it):
  ```ts
  export async function findDueSlots(nowIso: string): Promise<typeof scheduleSlots.$inferSelect[]>
  ```
  Selects `schedule_slots` where `datetime <= nowIso` AND `status = 'pending'` AND `agentAssignmentId IS NOT NULL`, ordered by `datetime ASC`.
- Add a transactional claim:
  ```ts
  export function claimSlotForRun(slotId: string): typeof scheduleSlots.$inferSelect | null
  ```
  Synchronous (matches the rest of the file's transaction style). Re-reads the slot; if status is not `pending`, returns `null`. Otherwise updates status to `in-progress` and returns the updated row.

No service changes are needed in `agentAssignments.service.ts` — `completeAgentAssignment(id)` already exists and transitions `in-progress → done`. The slot runner first sets the AA to `in-progress` via `startAgentAssignment` (which handles `pending → scheduled → in-progress` transitions), then completes it.

> Careful: `startAgentAssignment` from `pending` auto-allocates the next available slot. We don't want that here — the slot is already known. Use `setStatus`-equivalent transitions instead. Two options:
> - **(preferred)** Add a small `forceInProgress(id)` helper to `agentAssignments.service.ts` that bypasses slot-allocation and transitions any non-`done` AA to `in-progress`.
> - Or: skip the `in-progress` step and go straight from current status → `done` via a new permissive helper. Less honest in the audit trail.
>
> Implement option 1: `forceInProgress` accepts `pending | scheduled | blocked | in-progress` as inputs (`in-progress` is a no-op) and refuses `done`.

---

## Slot Runner Module

New file `src/agent/slotRunner.ts`. Single exported function:

```ts
export async function runDueSlot(slot: ScheduleSlot): Promise<void>
```

Responsibilities:

1. Load the AA via `getAgentAssignment(slot.agentAssignmentId)`. If the AA is `done` or missing → mark slot `done` (best-effort cleanup) and return.
2. Resolve `agentId = aa.agentId ?? 'intella'` and `model = process.env.AGENT_DEFAULT_MODEL ?? 'claude-sonnet-4.6'`.
3. Build the prompt — see [Prompt Template](#prompt-template).
4. Find-or-create a chat session via `findOrCreateSession({ agentId, contextType: 'slot', contextId: slot.id })`. The runner needs a session for transcript persistence.
5. `startInvocation({ trigger: 'slot_start', triggerRefId: slot.id, agentId, sessionId, model })`.
6. `createAgentOutput(aa.id, { agentId, input: prompt, model })`.
7. Move the AA to `in-progress` via the new `forceInProgress(aa.id)`.
8. Wire `onEvent` per [Event → Output-Step Mapping](#event--output-step-mapping). Track:
   - `assistantBuffer: string` — accumulating text for the in-flight assistant block.
   - `lastAssistantText: string` — last completed assistant block (becomes `response`).
   - `pendingToolCall: { id, name, input, startedAtMs } | null`.
9. `await run({ invocationId, sessionId, agentId, model, initialUserMessage: prompt, onEvent })`.
10. On resolve: `completeAgentOutput(outputId, { response: lastAssistantText, tokensIn: result.tokensIn, tokensOut: result.tokensOut })`, then `doneSlot(slot.id, {})` and `completeAgentAssignment(aa.id)`.
11. On reject: `failAgentOutput(outputId, { error: err.message, status: classifyStatus(err) })`. Do **not** revert slot status — leave at `in-progress`.

All of this lives in `runDueSlot`. The function never throws to its caller; it logs and returns.

---

## Tick Loop

New file `src/agent/slotTicker.ts`. Exposes:

```ts
export function startSlotTicker(opts?: { intervalMs?: number; logger?: Pick<Console, 'info'|'warn'|'error'> }): () => void
```

- Default interval: 60_000 ms.
- Holds an `isRunning` flag; if a tick fires while another is in progress, skip.
- Each tick:
  1. `const due = await findDueSlots(now())`.
  2. For each slot, **sequentially**:
     - `const claimed = claimSlotForRun(slot.id)`. If `null`, continue (already taken).
     - `await runDueSlot(claimed)`.
  3. Reset `isRunning`.
- Returns a stop function for tests / graceful shutdown.

---

## Bootstrap Wiring

Edit [src/index.ts](./src/index.ts):

After the gateway client `connect()` is dispatched and the routes are registered, but before `app.listen`:

```ts
import { startSlotTicker } from './agent/slotTicker.js';
const stopTicker = startSlotTicker({ logger: app.log as unknown as Console });
```

Don't gate on gateway readiness — the runner already handles "gateway not ready" by emitting an error event, which the slot runner translates into `failAgentOutput`. That's the correct behavior even on cold boot when the gateway hasn't connected yet.

Add a `process.on('SIGTERM', stopTicker)` and `process.on('SIGINT', stopTicker)` for graceful shutdown.

Optional env override: `SLOT_TICKER_INTERVAL_MS` for tests.

---

## Prompt Template

Exact format requested:

```
Please complete the following Agent Assignment:

{agent_assignment.title}

{agent_assignment.details}

<Extra Prompt (if exists)>
```

`{agent_assignment.title}` and `{agent_assignment.details}` are the `title` and `details` columns of the row returned by `getAgentAssignment(id)`. Do not include the rest of the AA row (status, slot list, timestamps, etc.) — only title and details.

`<Extra Prompt>` is the slot's `extraPrompt` column. If null/empty, omit the trailing line entirely (no empty trailing line, no placeholder).

Helper:

```ts
function buildSlotPrompt(aa: AgentAssignmentRow, extraPrompt: string | null): string {
  const title = aa.title ?? '';
  const details = aa.details ?? '';
  const base = `Please complete the following Agent Assignment:\n\n${title}\n\n${details}`;
  if (extraPrompt && extraPrompt.trim().length > 0) {
    return `${base}\n\n${extraPrompt.trim()}`;
  }
  return base;
}
```

---

## Event → Output-Step Mapping

`runner.run()` emits `AgentEvent`s (see [src/agent/events.ts](./src/agent/events.ts)). Translation rules:

| Event              | Action                                                                                                                                                              |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `session_started`  | Ignore. (Output already created.)                                                                                                                                   |
| `text_delta`       | `assistantBuffer += text`. No DB write per chunk.                                                                                                                   |
| `tool_use`         | Stash `pendingToolCall = { id, name, input, startedAtMs: Date.now() }`. No DB write yet — we wait for the result so we can store input + output + duration in one step. |
| `tool_result`      | If `pendingToolCall`: `appendAgentOutputStep(outputId, { kind: 'tool_call', toolName, toolInput, toolOutput: stringify(output), isError, durationMs })`. Clear pending. |
| `message_complete` | If `assistantBuffer.length > 0`: `appendAgentOutputStep(outputId, { kind: 'text', content: assistantBuffer })`; set `lastAssistantText = assistantBuffer`; clear buffer. |
| `done`             | Resolve the runner promise. Caller calls `completeAgentOutput(...)`.                                                                                                |
| `error` (fatal)    | Caller's `await run(...)` will reject. Caller calls `failAgentOutput(...)`.                                                                                         |
| `ping`             | Ignore.                                                                                                                                                             |

`thinking` events aren't currently emitted by the runner (the gateway doesn't surface them in `text_delta` form). Skip the `thinking` step kind for now; the schema supports it for future use.

`stringify(output)` for tool outputs: if `output` is a string, use as-is; otherwise `JSON.stringify(output)`. Empty/null becomes `null`.

The `appendAgentOutputStep` writes are awaited inside `onEvent`, but `onEvent` is sync. Use a serial promise queue inside `slotRunner.ts` (mirror the `queueTail` pattern in `runner.ts:112-118`) so step writes don't interleave or race with `completeAgentOutput`.

---

## Routes

No new routes. `PATCH /api/schedule/slots/:id` already exists; once `UpdateSlotSchema` accepts `extraPrompt`, that route writes it for free.

A test-only manual trigger could be useful — but skip it. Verification can poke a slot's `datetime` to a past value via direct DB and let the next tick fire.

---

## Docs to Update

After implementing (per [CLAUDE.md](./CLAUDE.md)):

- [src/db/SCHEMAS.md](./src/db/SCHEMAS.md) — add the `extra_prompt` row to the `schedule_slots` table.
- [src/services/SERVICES.md](./src/services/SERVICES.md) — add `findDueSlots`, `claimSlotForRun` to the schedule service section; add `forceInProgress` to the Agent Assignments service section; add a new "Slot Runner" subsection covering `runDueSlot` + `startSlotTicker`.
- [src/types/TYPES.md](./src/types/TYPES.md) — note the `extraPrompt` field on `UpdateSlotInput`.
- [src/routes/ROUTES.md](./src/routes/ROUTES.md) — note that `PATCH /api/schedule/slots/:id` accepts `extraPrompt`.
- [README.md](./README.md) — one bullet under the feature list: *"Slots fire at their scheduled time and run their assigned agent."*

---

## Execution Order

1. **Schema** — add `extraPrompt` column to `schedule_slots`. Generate + apply migration.
2. **Types** — extend `UpdateSlotSchema` with `extraPrompt`.
3. **Schedule service** — extend `updateSlot`; add `findDueSlots`, `claimSlotForRun`.
4. **AA service** — add `forceInProgress(id)`.
5. **Slot runner module** — `src/agent/slotRunner.ts` with `runDueSlot`.
6. **Slot ticker** — `src/agent/slotTicker.ts` with `startSlotTicker`.
7. **Bootstrap** — register ticker in `src/index.ts`; SIGTERM/SIGINT shutdown.
8. **Docs** — SCHEMAS.md, SERVICES.md, TYPES.md, ROUTES.md, README.md.

---

## Verification

1. **Manual fire path:**
   - Insert a fresh AA on a task: `curl -X POST .../api/tasks/:taskId/agent-assignments -d '{"title":"smoke test"}'`.
   - Generate a week plan if needed; assign the AA to a slot via `POST /api/schedule/assign`.
   - Backdate the slot's `datetime` directly: `sqlite3 data/mc.db "UPDATE schedule_slots SET datetime='2020-01-01T00:00' WHERE id='...'"`.
   - Wait up to 60s. Confirm:
     - Slot status flips `pending → in-progress → done`.
     - AA status flips to `done`.
     - `GET /api/agent-assignments/:id/outputs` returns one output, status `complete`.
     - `GET /api/agent-outputs/:outputId` returns ordered steps: alternating `text` and `tool_call` matching the run.
2. **Idempotency:**
   - Two ticks in a row don't duplicate. Confirm there's only one Agent Output row per slot.
3. **Failure path:**
   - Kill the gateway before backdating a slot.
   - Confirm slot stays `in-progress`, Agent Output ends with `status='error'` and a non-null `error` message.
4. **`extraPrompt` plumbing:**
   - `PATCH /api/schedule/slots/:id` with `{"extraPrompt":"focus on edge cases"}`.
   - Run the slot. Confirm the `agent_outputs.input` column contains both the AA JSON and the trailing extra prompt.
5. **Typecheck:** `bun run build` (or repo equivalent) passes.

---

## Out of Scope

- **Linked Contexts on slots.** Currently iOS-only `@State` (see [TimeSlotView.swift](../mission-control-ios/MissionControl/Views/Schedule/TimeSlotView.swift)). The persistence layer + service + runner injection lands in a follow-up plan.
- **Linked Context Groups on slots.** Same as above.
- **Streaming.** No SSE channel publishes step appends to iOS. iOS will see the run after it finishes via `GET /api/agent-outputs/:id`. Live streaming layered on later.
- **Retries.** Failed slots don't automatically retry. User intervention required.
- **Brief slots.** `slotType === 'brief'` slots don't have an `agentAssignmentId`; the existing brief-generation runner (still TODO) is a different path. The tick loop ignores brief slots by virtue of the `agentAssignmentId IS NOT NULL` filter.
- **`thinking` step kind.** Schema supports it; runner doesn't emit it. Wire it in when the gateway exposes thinking blocks separately.
- **Per-slot duration limits / hard timeouts.** The runner has a `timeoutSeconds` knob but the slot runner doesn't pass one. Add later if needed.
