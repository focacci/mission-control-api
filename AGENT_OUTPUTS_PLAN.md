# Agent Outputs Plan

Self-contained spec for a clean agent session. Scope spans both repos:
- `/Users/michaelfocacci/dev/Intella/mission-control-api/` (Fastify + Drizzle + SQLite)
- `/Users/michaelfocacci/dev/Intella/mission-control-ios/` (SwiftUI)

## Contents
- [Motivation](#motivation)
- [Concept](#concept)
- [DB Schema](#db-schema)
- [Types (Zod)](#types-zod)
- [Service Layer](#service-layer)
- [Routes](#routes)
- [iOS Models](#ios-models)
- [iOS APIClient](#ios-apiclient)
- [iOS Views](#ios-views)
- [Chat Context Kind](#chat-context-kind)
- [Docs to Update](#docs-to-update)
- [Execution Order](#execution-order)
- [Verification](#verification)
- [Out of Scope](#out-of-scope)

---

## Motivation

Agent Assignments are chunks of work delegated to an agent. We need a structured way to preserve **what the agent actually did** when it ran one — not a chat log, but a discrete record of one autonomous run: the input it was given, the thinking it did, every tool call (with arguments and outputs), and the final response.

Agent Outputs are deliberately **distinct from chat history** (`chat_sessions` / `chat_messages`). Chat is a free-form conversation. An Agent Output is a self-contained run of an Agent Assignment that we will eventually grow into structured agentic workflows (multi-step plans, branching tool use, retries, etc.). Keeping the model separate from chat from day one avoids retrofitting later.

There is no production write path yet — no scheduled-slot runner emits these — so this plan ships **schema + read API + UI shell + a simple write path for tests/manual creation**, leaving the production emission contract to be wired up alongside the slot-start runner.

---

## Concept

```
agent_assignments
  └── agent_outputs              [NEW — one row per agent run]
        └── agent_output_steps   [NEW — ordered sequence of what happened]
```

**`agent_outputs`** — header for one run. Holds the input prompt the agent saw, the final assistant response, model, token totals, status, timing, and an optional error.

**`agent_output_steps`** — ordered sequence of typed events that happened during the run. Three kinds:
- `thinking` — extended-thinking content block from the model
- `tool_call` — one tool invocation (name + input JSON + output + isError + timing)
- `text` — an assistant text block (intermediate or final). The final assistant text is also denormalized onto `agent_outputs.response` for cheap list rendering.

Steps are ordered by `sortOrder` (monotonic per-output). This shape is intentionally close to the Anthropic SDK's content-block stream so future production wiring is a thin adapter.

---

## DB Schema

Add to `src/db/schema.ts`:

```ts
export const agentOutputs = sqliteTable('agent_outputs', {
  id: text('id').primaryKey(),
  agentAssignmentId: text('agent_assignment_id')
    .notNull()
    .references(() => agentAssignments.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['running', 'complete', 'error', 'cancelled'],
  })
    .notNull()
    .default('running'),
  input: text('input').notNull(),
  response: text('response'),
  model: text('model'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  error: text('error'),
});

export const agentOutputSteps = sqliteTable('agent_output_steps', {
  id: text('id').primaryKey(),
  outputId: text('output_id')
    .notNull()
    .references(() => agentOutputs.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['thinking', 'tool_call', 'text'] }).notNull(),
  // For 'thinking' and 'text': the content goes here.
  // For 'tool_call': null (use toolName/toolInput/toolOutput).
  content: text('content'),
  toolName: text('tool_name'),
  // JSON string. Structured input the agent passed.
  toolInput: text('tool_input'),
  // Stringified output (tool result). MCP results are typically text blocks.
  toolOutput: text('tool_output'),
  isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  durationMs: integer('duration_ms'),
});
```

**Cascade rules:** deleting an Agent Assignment deletes its outputs; deleting an output deletes its steps. The `agentId` link is `set null` so deleting an agent leaves the output intact (keeps the run record even if the agent definition changes).

**No FK to `agentInvocations`.** Agent Outputs are the structured record we want long-term; `agent_invocations` is a chat-runner artifact. Keep them independent — if a future runner happens to also produce an invocation row, the bridge can live in service code.

---

## Types (Zod)

Add to `src/types/index.types.ts`:

```ts
export const AGENT_OUTPUT_STATUSES = ['running', 'complete', 'error', 'cancelled'] as const;
export type AgentOutputStatus = (typeof AGENT_OUTPUT_STATUSES)[number];

export const AGENT_OUTPUT_STEP_KINDS = ['thinking', 'tool_call', 'text'] as const;
export type AgentOutputStepKind = (typeof AGENT_OUTPUT_STEP_KINDS)[number];

export const CreateAgentOutputSchema = z.object({
  agentId: z.string().nullable().optional(),
  input: z.string().min(1),
  model: z.string().nullable().optional(),
});
export type CreateAgentOutputInput = z.infer<typeof CreateAgentOutputSchema>;

export const AppendAgentOutputStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('thinking'),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('text'),
    content: z.string(),
  }),
  z.object({
    kind: z.literal('tool_call'),
    toolName: z.string().min(1),
    toolInput: z.unknown(),       // service serializes to JSON
    toolOutput: z.string().nullable().optional(),
    isError: z.boolean().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
]);
export type AppendAgentOutputStepInput = z.infer<typeof AppendAgentOutputStepSchema>;

export const CompleteAgentOutputSchema = z.object({
  response: z.string(),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
});
export type CompleteAgentOutputInput = z.infer<typeof CompleteAgentOutputSchema>;

export const FailAgentOutputSchema = z.object({
  error: z.string().min(1),
  status: z.enum(['error', 'cancelled']).default('error'),
});
export type FailAgentOutputInput = z.infer<typeof FailAgentOutputSchema>;
```

---

## Service Layer

New file `src/services/agentOutputs.service.ts`. Functions:

```ts
// Header creation — opens a new running output.
createAgentOutput(agentAssignmentId: string, input: CreateAgentOutputInput): Promise<AgentOutput>

// Append one step. Returns the step. Auto-assigns sortOrder = max+1.
// For tool_call: serializes toolInput via JSON.stringify, sets startedAt=now,
// and computes endedAt = startedAt + durationMs when durationMs given.
appendAgentOutputStep(outputId: string, input: AppendAgentOutputStepInput): Promise<AgentOutputStep>

// Complete — sets status='complete', endedAt=now, writes response + tokens.
// 409 if status is not 'running'.
completeAgentOutput(outputId: string, input: CompleteAgentOutputInput): Promise<AgentOutput>

// Fail — sets status='error'|'cancelled', endedAt=now, writes error.
failAgentOutput(outputId: string, input: FailAgentOutputInput): Promise<AgentOutput>

// List for an assignment — returns header rows ordered by startedAt DESC, no steps.
listAgentOutputsForAssignment(agentAssignmentId: string): Promise<AgentOutput[]>

// Detail — header + ordered steps. Used by both push-nav detail and the
// (future) sheet variant.
getAgentOutput(outputId: string): Promise<AgentOutputDetail>

// Hard delete — cascades to steps via FK.
deleteAgentOutput(outputId: string): Promise<void>
```

**Return shapes:**

```ts
export type AgentOutput = typeof agentOutputs.$inferSelect;
export type AgentOutputStep = typeof agentOutputSteps.$inferSelect;

export interface AgentOutputDetail {
  output: AgentOutput;
  steps: AgentOutputStep[];
}
```

**Behavior notes:**
- All mutations throw `AppError(404)` if the parent doesn't exist.
- `appendAgentOutputStep` is rejected with 409 if the output's `status !== 'running'`.
- `tool_call` steps store `toolInput` as `JSON.stringify(input.toolInput)`.
- The service does not read or write `agent_invocations` — fully independent.

---

## Routes

New file `src/routes/agentOutputs.routes.ts`:

```ts
// Nested under agent assignment
GET    /api/agent-assignments/:id/outputs                 → AgentOutput[]
POST   /api/agent-assignments/:id/outputs                 → 201 AgentOutput  (CreateAgentOutputInput)

// Output-scoped
GET    /api/agent-outputs/:id                             → AgentOutputDetail
DELETE /api/agent-outputs/:id                             → 204
POST   /api/agent-outputs/:id/steps                       → 201 AgentOutputStep  (AppendAgentOutputStepInput)
POST   /api/agent-outputs/:id/complete                    → AgentOutput  (CompleteAgentOutputInput)
POST   /api/agent-outputs/:id/fail                        → AgentOutput  (FailAgentOutputInput)
```

Register in `src/index.ts`. All handlers are thin: parse with Zod, call service, return.

---

## iOS Models

New file `Shared/Models/AgentOutput.swift`:

```swift
struct AgentOutput: Codable, Identifiable, Hashable {
    let id: String
    let agentAssignmentId: String
    let agentId: String?
    let status: Status
    let input: String
    let response: String?
    let model: String?
    let tokensIn: Int
    let tokensOut: Int
    let startedAt: String
    let endedAt: String?
    let error: String?

    enum Status: String, Codable, CaseIterable {
        case running, complete, error, cancelled
    }
}

struct AgentOutputStep: Codable, Identifiable, Hashable {
    let id: String
    let outputId: String
    let kind: Kind
    let content: String?
    let toolName: String?
    let toolInput: String?       // raw JSON string, decoded on demand
    let toolOutput: String?
    let isError: Bool
    let sortOrder: Int
    let startedAt: String
    let endedAt: String?
    let durationMs: Int?

    enum Kind: String, Codable {
        case thinking, toolCall = "tool_call", text
    }
}

struct AgentOutputDetail: Codable, Hashable {
    let output: AgentOutput
    let steps: [AgentOutputStep]
}
```

Add status icon/color helpers (`statusIcon`, `statusColor`, `statusLabel`) on `AgentOutput.Status` mirroring `AgentInvocation.Status` styling.

---

## iOS APIClient

Add to `Shared/Services/APIClient.swift`:

```swift
func agentOutputs(forAssignment id: String) async throws -> [AgentOutput]
func agentOutput(id: String) async throws -> AgentOutputDetail
func createAgentOutput(forAssignment id: String, body: CreateAgentOutputBody) async throws -> AgentOutput
func appendAgentOutputStep(outputId: String, body: AppendAgentOutputStepBody) async throws -> AgentOutputStep
func completeAgentOutput(id: String, body: CompleteAgentOutputBody) async throws -> AgentOutput
func failAgentOutput(id: String, body: FailAgentOutputBody) async throws -> AgentOutput
func deleteAgentOutput(id: String) async throws
```

`AppendAgentOutputStepBody` mirrors the Zod discriminated union — easiest as an enum with associated values + a custom `Encodable`. `toolInput` is `Encodable` (commonly `[String: AnyCodable]`); the API serializes it to JSON.

---

## iOS Views

### 1. `Views/AgentAssignments/AgentOutputDetailView.swift` (NEW)

Push-navigation detail view. Renders one Agent Output as a vertically scrolling timeline:

- **Header section:** status icon + label, model, started/ended, token usage, duration. If errored, show the error inline.
- **Input section:** the prompt the agent received (read-only text block).
- **Run section:** ordered list of steps, each rendered by kind:
  - `thinking` — italic, secondary-color, `lightbulb` icon, collapsible (default collapsed).
  - `tool_call` — bordered card: tool name + duration in header, expandable to show pretty-printed `toolInput` and `toolOutput`. Red tint when `isError`.
  - `text` — body text block.
- **Response section:** the final assistant response (denormalized `output.response`). If status is `running`, show a `ProgressView` placeholder.

Apply `.chatContext(.agentOutput(id: output.id, title: ...))` and `.chatContextToolbar()` so the receipt header button is present. Title: assignment title; subtitle: started-at relative.

### 2. `Views/AgentAssignments/AgentOutputRow.swift` (NEW)

Reusable row for the list section: status icon, model, started-at relative, token total, truncated response preview.

### 3. `Views/AgentAssignments/AgentAssignmentDetailView.swift` (EDIT)

Add a new `Section("Agent Outputs")` at the bottom of the `List` (after `ContextChatHistorySection`). Lifecycle:

- ViewModel gains `var outputs: [AgentOutput] = []` and `func loadOutputs() async`.
- Loaded in `.task`; refreshed in `.refreshable`.
- Each row uses `NavigationLink(value: output)` — push goes to `AgentOutputDetailView`.
- Empty state: "No agent outputs yet." secondary text.
- The view's `NavigationStack` (one level up — `TasksView` / `GoalsView` / etc.) needs `.navigationDestination(for: AgentOutput.self) { AgentOutputDetailView(output: $0) }`. Find every `NavigationStack` that already presents `AgentAssignmentDetailView` and add the destination there too. Likely callers (verify with grep `AgentAssignmentDetailView`):
  - `Views/Tasks/TaskDetailView.swift`
  - `Views/Goals/GoalDetailView.swift`
  - `Views/Initiatives/InitiativeDetailView.swift`
  - `Views/Schedule/SlotDetailView.swift`
  - `Views/Schedule/TimeSlotView.swift`

Swiping back from `AgentOutputDetailView` returns to `AgentAssignmentDetailView` automatically (standard `NavigationStack` behavior).

---

## Chat Context Kind

Add a new case to `ChatContextKind` in `Views/FloatingChat/ChatContextStore.swift`:

```swift
case agentOutput(id: String, title: String)
```

Update the helpers in `ChatContextStore` (`icon(for:)`, `label(for:)`, `typeName(for:)`, payload encoding for pinning) to handle the new case:
- icon: `"doc.text.magnifyingglass"`
- typeName: `"Agent Output"`
- label: the passed title

---

## Docs to Update

After the code changes, per `mission-control-api/CLAUDE.md`:

- `src/db/SCHEMAS.md` — add `agent_outputs` and `agent_output_steps` table sections, update TOC.
- `src/routes/ROUTES.md` — add the six new routes under a new "Agent Outputs" heading, update TOC.
- `src/services/SERVICES.md` — add a new "Agent Outputs Service" section listing each function with signature + notes, update TOC.
- `src/types/TYPES.md` — add `AGENT_OUTPUT_STATUSES`, `AGENT_OUTPUT_STEP_KINDS`, the new Zod schemas, inferred types, update TOC.
- `README.md` — only if the high-level feature summary needs to mention Agent Outputs (probably yes — add one bullet under the feature list).

No iOS docs to update (the iOS repo doesn't use the same docs convention).

---

## Execution Order

1. **Schema** — add tables to `src/db/schema.ts`. Generate + apply Drizzle migration.
2. **Types** — add Zod schemas, inferred types, constants in `src/types/index.types.ts`.
3. **Service** — create `src/services/agentOutputs.service.ts` with all eight functions.
4. **Routes** — create `src/routes/agentOutputs.routes.ts`, register in `src/index.ts`.
5. **API docs** — SCHEMAS.md, ROUTES.md, SERVICES.md, TYPES.md, README.md.
6. **iOS models** — `Shared/Models/AgentOutput.swift` + status helpers.
7. **iOS APIClient** — add the six methods + body types.
8. **iOS chat context** — add `.agentOutput` case + store helpers.
9. **iOS views** — `AgentOutputRow.swift`, `AgentOutputDetailView.swift`, edit `AgentAssignmentDetailView.swift` to add the section + viewmodel hook.
10. **iOS nav destinations** — grep callers of `AgentAssignmentDetailView` and add `.navigationDestination(for: AgentOutput.self)` to each parent `NavigationStack`.

---

## Verification

- `bun run typecheck` (or repo equivalent) passes in `mission-control-api/`.
- New routes respond correctly via curl:
  - Create an output: `POST /api/agent-assignments/:id/outputs`
  - Append a `thinking`, a `tool_call`, and a `text` step
  - `POST /complete` and confirm `GET /api/agent-outputs/:id` returns header + steps in order
  - Listing the assignment returns the new output
  - Deleting the assignment cascades the output and its steps (verify rows gone)
- iOS build succeeds; opening an Agent Assignment shows the new "Agent Outputs" section; tapping a row pushes the detail view; receipt button appears in the header; swipe-back returns to the AA detail.
- With status=`running`, the detail view shows a progress indicator in the response slot.

---

## Out of Scope

- **Time Slot view integration.** Explicitly cut — minimal value before the slot-start runner exists.
- **Production write path.** No code in the chat orchestrator, brief generator, or future slot runner emits Agent Outputs yet. The write API exists for tests and for the runner work that will follow.
- **Streaming.** Step append is a sync REST call; no SSE for live step arrival. Live streaming can be layered on later when the runner needs it.
- **Editing finished outputs.** Only delete is supported — outputs are immutable once `complete`/`error`/`cancelled`.
- **Linking to `agent_invocations`.** Intentionally separate; bridging (if ever needed) is service-layer glue, not a schema FK.
