# Phase 2 UI — Claude-Code-Style Agent Activity in Chat

> Companion to [CONTROL_LAYER_PLAN.md](CONTROL_LAYER_PLAN.md) §5.
>
> The plan spells out the runner, events, and SSE route. This doc covers
> what is needed to turn those events into a **live, compact, legible
> activity display** inside Intella iOS — modeled on the way Claude Code
> surfaces tool calls inline without dominating the chat.
>
> Scope: the iOS chat surface and the small pieces the API needs to ship
> alongside the runner so that surface works well on first try.

## Contents

- [1. Why this doc exists](#1-why-this-doc-exists)
- [2. Design target — what we're imitating](#2-design-target--what-were-imitating)
- [3. Event model (reconfirmed)](#3-event-model-reconfirmed)
- [4. iOS data model — `ChatTurn` and `ChatSegment`](#4-ios-data-model--chatturn-and-chatsegment)
- [5. Rendering — collapsed by default, expand on tap](#5-rendering--collapsed-by-default-expand-on-tap)
- [6. SSE consumer on iOS](#6-sse-consumer-on-ios)
- [7. API additions beyond §5 of the plan](#7-api-additions-beyond-5-of-the-plan)
- [8. Tool presenters — one-line summaries per tool](#8-tool-presenters--one-line-summaries-per-tool)
- [9. POC slice (minimum demo)](#9-poc-slice-minimum-demo)
- [10. What the plan is missing or under-specifies](#10-what-the-plan-is-missing-or-under-specifies)
- [11. Acceptance criteria for the UI](#11-acceptance-criteria-for-the-ui)
- [12. Execution order](#12-execution-order)

---

## 1. Why this doc exists

[CONTROL_LAYER_PLAN.md §5.3](CONTROL_LAYER_PLAN.md#53-agent-runner-srcagentrunnerts-new)
defines the server-side streaming contract but leaves the client side to
"iOS consumes SSE via `URLSession.bytes`" (§7.6). That is the whole point
of Phase 2 from a user's perspective — watching the agent *actually
work* — and it is the part most likely to go sideways without a design.

This document exists so a coding agent can implement the UI without
re-deriving the event vocabulary, grouping rules, or reconnect story.

It is **not** a replacement for the plan. Build §5.1–§5.4 first. Everything
below assumes the runner emits the events listed in §3.

---

## 2. Design target — what we're imitating

Claude Code's activity display works for three reasons. All three carry over.

1. **One line per action, status-shaped.**
   A tool call collapses to `● tool(arg-summary)` with a leading status glyph
   (running / ok / error), a truncated arg preview, and a duration when
   finished. No raw JSON, no input schema noise. The line is selectable but
   otherwise static.

2. **Expand-on-demand.**
   Tapping a line reveals the full input + output, pretty-printed and
   scrollable. Collapsed is the default and stays that way on re-render.

3. **Interleaved, not segregated.**
   Tool steps appear inline with the assistant's prose in the order they
   happened. They do not get their own sidebar or their own "activity tab."
   The transcript *is* the activity log.

What Claude Code does that we should skip for now:

- Parallel tool columns (they only help for branching agents; our runner
  serializes).
- Diff-rendering for file edits (not applicable — our tools are CRUD-ish).
- Long-form reasoning blocks (we are not enabling `thinking` in Phase 2;
  the plan does not list it).

What we need that Claude Code's UI does not have to worry about:

- **Mobile scroll physics** — streaming tokens fight the user when they
  scroll up to read a prior step. Need an "anchor at bottom until user
  scrolls" rule.
- **Session resume after the app is backgrounded** — on desktop CLI the
  process is always attached; on iOS we will regularly lose the stream.

---

## 3. Event model (reconfirmed)

Re-listed here so the UI side has one reference. Matches the plan's §5.3
`AgentEvent` union; additions for UI reasons are marked.

| Event | Fields | UI purpose |
|---|---|---|
| `session_started` *(add)* | `sessionId`, `invocationId` | Lets the UI bind the turn to an invocation so "view details" can deep-link. |
| `text_delta` | `text` | Appends to the current assistant text segment. |
| `tool_use` | `id`, `name`, `input` (complete) | Opens a new tool step in `running` state. |
| `tool_input_delta` *(optional, add)* | `id`, `partialJson` | Live "typing" of tool input. Nice-to-have; skippable in POC. |
| `tool_result` | `id`, `output`, `isError`, `durationMs` | Closes the matching tool step. |
| `message_complete` | `messageId` | Marks the current assistant text segment as finalized and bound to a DB row. |
| `done` | `tokensIn`, `tokensOut` | Closes the turn. Enables the send button again. |
| `error` | `error`, `fatal?` | Shows an inline error chip on the turn. |
| `ping` *(add, every 15s)* | `ts` | Keeps proxy / mobile NAT from dropping the stream; UI ignores. |

**Order guarantee (the UI relies on this):**

```
session_started
  (text_delta* | (tool_use → tool_result))*
  message_complete
done
```

Any `error` may appear at any point; `fatal: true` means no more events
follow.

---

## 4. iOS data model — `ChatTurn` and `ChatSegment`

The current `ChatMessage` struct in
[ChatConversationView.swift](../mission-control-ios/MissionControl/Views/FloatingChat/ChatConversationView.swift)
is `{ role, content }` — too flat to hold interleaved tool steps.

Replace with:

```swift
struct ChatTurn: Identifiable {
    let id = UUID()
    let role: Role          // .user or .assistant
    var segments: [ChatSegment]
    var invocationId: String?
    var state: TurnState    // .streaming, .complete, .failed
    var tokensIn: Int?
    var tokensOut: Int?

    enum Role { case user, assistant }
    enum TurnState { case streaming, complete, failed(String) }
}

enum ChatSegment: Identifiable {
    case text(TextSegment)
    case toolStep(ToolStep)

    var id: String {
        switch self {
        case .text(let t): return t.id
        case .toolStep(let s): return s.id
        }
    }
}

struct TextSegment: Identifiable {
    let id: String         // messageId once finalized; tmp uuid before
    var text: String
    var isFinal: Bool
}

struct ToolStep: Identifiable {
    let id: String         // tool_use_id from Anthropic
    let name: String
    var input: String      // JSON pretty-printed
    var output: String?
    var isError: Bool
    var durationMs: Int?
    var state: StepState
    var isExpanded: Bool   // UI-only; persists within view lifetime

    enum StepState { case running, ok, failed }
}
```

A **user turn** is a single `TextSegment`. An **assistant turn** may contain
many segments in any order:

```
assistant turn
├── text("Let me check the board first.")
├── toolStep(board, ok, 220ms)
├── text("You have 3 active initiatives. I'll mark the requirement done now.")
├── toolStep(tasks.check_requirement, ok, 180ms)
└── text("Done — anything else?")
```

Reducing `AgentEvent` → `ChatTurn` mutation is a single deterministic
function; easy to unit test in isolation.

---

## 5. Rendering — collapsed by default, expand on tap

### 5.1 Turn container

One `VStack` per turn, no bubble wrapper for assistant turns — bubbles
feel wrong once there is non-text content. User turns keep the existing
blue bubble.

```
┌ assistant column (full-width, left-aligned) ────────────────
│ Let me check the board first.
│ ● board                                            220ms
│ You have 3 active initiatives. I'll mark the
│ requirement done now.
│ ● tasks.check_requirement(reqId: "abc…")           180ms
│ Done — anything else?
│ ──────────────────────────────────  · 342 tokens · view run
└───────────────────────────────────────────────────────────
```

Footer row shows: total tokens, a trailing `view run →` that pushes
`InvocationDetailView` for the full audit. This is the bridge between
the live UX and the existing debug UI.

### 5.2 Tool step row — collapsed

A single line, `.body.monospaced()` for the name, `.footnote` for the
arg summary, `.caption.monospacedDigit()` for the duration.

```
● tasks(action: complete, id: tsk_abc)                       180ms
```

Leading glyph maps state:

| State | Glyph | Color |
|---|---|---|
| running | `circle.dotted` (spinning) | `.blue` |
| ok | `circle.fill` | `.green.opacity(0.8)` |
| failed | `xmark.circle.fill` | `.red` |

The arg summary is produced by a **tool presenter** (see §8), not by
dumping input JSON. Fall back to `JSON.compact(input)` truncated to ~60
chars.

### 5.3 Tool step row — expanded

Tap the row to toggle `isExpanded`. Expanded reveals a disclosure region
below the line:

```
● tasks(action: complete, id: tsk_abc)                       180ms
  ╭ input ───────────────────────────────
  │ {
  │   "action": "complete",
  │   "id": "tsk_abc",
  │   "summary": "Wired up auth middleware"
  │ }
  ╰───────────────────────────────────────
  ╭ output ──────────────────────────────
  │ { "id": "tsk_abc", "status": "done", … }
  ╰───────────────────────────────────────
```

Keep it visually quieter than the transcript text — smaller font,
muted `.secondary` background, no bubble corner radius stacking.
Reuse the `InvocationDetailView` tool-call card styling so the two
surfaces feel consistent.

### 5.4 Streaming text behavior

- Append-in-place to the last `TextSegment` in the current turn.
- Only auto-scroll to bottom when the user is already at the bottom
  (tracked with `ScrollViewReader` + a `@State var isPinnedToBottom`).
  If they scrolled up, leave them there; show a small "↓ new" pill to
  jump back.
- Render Markdown with `LocalizedStringKey` (current code already does
  this for bubbles).

### 5.5 Error states

- **Tool error** (`tool_result.isError`): row goes red, output body
  shown, transcript continues normally.
- **Turn error** (`error` event, non-fatal): inline red chip under the
  last segment, turn state → `.failed`. Input bar re-enables; user can
  resend.
- **Fatal** (`error` event, fatal: true): same chip, but the
  retry button suggests `view run →` because the invocation row holds
  the full context.
- **Token cap hit** (429-shape): distinct copy ("Daily limit reached").
  Do not log as an error — log as a limit.

---

## 6. SSE consumer on iOS

The existing `ChatService.send(...)` does a plain `URLSession.data(for:)`.
For streaming, add a sibling method and a new `EventSource`-style helper.

```swift
@MainActor
final class ChatStream: ObservableObject {
    @Published private(set) var turn: ChatTurn
    @Published private(set) var isRunning = false

    func run(
        message: String,
        context: ChatContextKind,
        sessionId: String?,
        useDefaultAgent: Bool
    ) async throws {
        isRunning = true
        defer { isRunning = false }

        // Build POST /api/chat/stream
        let (byteStream, response) = try await URLSession.shared.bytes(for: req)
        try validate(response)

        for try await line in byteStream.lines {
            guard let event = SSEParser.feed(line) else { continue }
            apply(event) // mutates `turn`
        }
    }
}
```

Minimum parser state: track the last `event:` tag and buffer `data:`
lines until an empty line. Decode `data` as JSON and dispatch by event
type to an `apply(_ event: AgentEvent)` reducer that owns the
`ChatTurn` state transitions described in §4.

**Backgrounding:** iOS suspends the socket after ~30s in the background.
Policy:
- If the app is foregrounded again and `isRunning == true`, attempt to
  **reconnect by fetching the invocation** (see §7.3). Do not replay
  events; jump straight to the finished state.
- If the user killed the app, the next time they open that session the
  UI reads the persisted transcript + tool calls and rebuilds turns.

---

## 7. API additions beyond §5 of the plan

The plan's §5 is sufficient to *produce* events but leaves three gaps that
the UI needs.

### 7.1 Combined activity endpoint

Today, rebuilding a turn requires joining `chat_messages` with
`tool_call_log` by `invocationId`. The debug view does this once per
invocation; the chat history view does not, so **re-opening a session
loses all tool-call context**.

Add:

```
GET /api/chat/sessions/:id/activity?limit=&before=
```

Returns an ordered array of `ChatActivityEvent`:

```ts
type ChatActivityEvent =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'tool_call'; call: ToolCallLog }
```

Ordering rule: messages sort by `sortOrder`; tool calls interleave at the
position of their `messageId`, sorted by `startedAt`. This gives iOS a
one-call source of truth that maps 1:1 to `ChatSegment`.

### 7.2 Cancel endpoint

```
POST /api/invocations/:id/cancel
```

Aborts the `AbortController` in the runner, fails the invocation with
`status='cancelled'`. The SSE stream emits `error` with `fatal: true`
and closes. The iOS stop button (replaces send while running) calls this.

Without it, once a user kicks off a slow agent turn they are stuck.

### 7.3 Invocation snapshot for resume

`GET /api/invocations/:id` already exists (Phase 1). Formalize its use
for reconnect: when iOS loses the stream mid-turn, poll this endpoint
once per second until `status !== 'running'`, then rebuild the turn from
the snapshot.

No code change — just document that this is the resume path and size
the response accordingly (currently unbounded; cap messages + tool calls
at 500 per invocation defensively).

### 7.4 Heartbeat

The runner currently has no idle gap, but the Anthropic stream can stall
for several seconds on long tool executions. Add a 15s `setInterval` in
the SSE route that emits `event: ping\ndata: {}\n\n`. Trivial to add;
saves debugging "did the connection die" a dozen times.

### 7.5 Presenter hints on `tool_result`

Optional. See §8 — if we go server-side, the result payload grows one
field:

```ts
{ id, output, isError, durationMs, summary?: string }
```

Where `summary` is the one-line human string ("Completed task X"). iOS
falls back to its own presenter if missing.

---

## 8. Tool presenters — one-line summaries per tool

Raw JSON arguments and outputs are readable but noisy. We want the
collapsed line to be speakable: "checked the board", "completed task X".
Two places to do this.

**Server side** (preferred for briefs + reuse):

Add `src/agent/presenters.ts`:

```ts
interface ToolPresenter {
  argSummary(input: unknown): string;   // for collapsed line
  resultSummary(output: unknown, isError: boolean): string;
}

export const PRESENTERS: Record<string, ToolPresenter> = {
  board: {
    argSummary: () => 'full board',
    resultSummary: (out) => `${out.goals?.length ?? 0} goals, …`,
  },
  tasks: {
    argSummary: (input) => `${input.action}${input.id ? ' ' + shortId(input.id) : ''}`,
    resultSummary: (out, isError) => isError ? out.error : 'ok',
  },
  // schedule, initiatives, goals, health …
};
```

Pump `resultSummary` through the SSE `tool_result.summary` field (§7.5).
For briefs (Phase 4) this is also what we feed into the brief's
"agent activity" roll-up.

**Client side** (fallback):

`ToolPresenter.swift` with the same shape. Used when the server field
is missing. Keep these thin — anything more than one `switch` per tool
belongs on the server.

---

## 9. POC slice (minimum demo)

Ship this first, in this order. Each step is independently verifiable.

1. **Runner + SSE** — §5.1–§5.5 of the plan. No iOS changes. Verify with
   `curl -N` hitting `/api/chat/stream`. This is the load-bearing
   prerequisite.
2. **iOS stream consumer** — new `ChatStream` + `SSEParser`. Render text
   deltas only (ignore tool events). Prove streaming tokens show up in
   the existing bubble. Keep old `POST /api/chat` path behind a feature
   flag so we can fall back instantly.
3. **ChatTurn / ChatSegment refactor** — swap the old `[ChatMessage]`
   array. No visual change yet; this is just a structural refactor to
   accept segments.
4. **Tool step row, collapsed only** — render `tool_use` / `tool_result`
   as inline rows. No expand yet. Presenters: server-side, three tools
   (`board`, `tasks`, `schedule`). Others: JSON fallback.
5. **Expand on tap** — disclosure region with pretty input/output.
6. **Footer + view-run link** — token count, nav-push to
   `InvocationDetailView` using the `invocationId` on the turn.
7. **Cancel button + stop state** — add §7.2 endpoint, swap send → stop
   while streaming.
8. **Activity endpoint + history reconstruction** — §7.1, so tapping a
   past session in `ChatHistoryView` restores the rich turn display.
9. **Reconnect on foreground** — §7.3, polish.

Demo gate between steps 5 and 6: if the compact collapsed rows are not
visually quiet enough, iterate there before sinking time into the rest.

---

## 10. What the plan is missing or under-specifies

| # | Gap | Where it bites |
|---|---|---|
| G1 | **History reconstruction** after Phase 2. `chat_messages` only stores final text; tool context is lost when re-opening a session. | Every time the user revisits a chat, loses the "nice" UI. §7.1 closes this. |
| G2 | **Cancel path.** Runner respects `AbortController` but there is no route that trips it. | Stuck turns, unkillable on mobile. §7.2. |
| G3 | **Reconnect / resume semantics** for dropped SSE. | Backgrounding iOS breaks every long turn. §7.3. |
| G4 | **Heartbeat.** Long tool executions go quiet for 5–10s; corporate networks will drop that. | Intermittent "stream died" bugs in prod. §7.4. |
| G5 | **Tool output presentation.** Plan stores raw JSON; UI needs one-liners. | Collapsed row looks like `tasks({"action":"complete",...})`. §8. |
| G6 | **Turn-level error taxonomy.** Plan lumps all failures into one `error` event. UI wants to distinguish transport, agent, tool, and cap-hit. | Same red chip for very different failures. §5.5. |
| G7 | **Partial tool-input streaming** (`input_json_delta`). Nice-to-have for long inputs. Plan omits. | Quiet pause between `tool_use` and the first byte of result. Optional. |
| G8 | **Turn-final token footer.** Plan emits totals on `done` but does not bind them to the assistant turn in the DB. | Footer has to read from `agent_invocations` separately — fine, just document it. |
| G9 | **Interleaving in the DB.** A multi-step turn produces several assistant `chat_messages` rows (one per `message_stop`). Need to confirm the runner writes a row per cycle with monotonically increasing `sortOrder`, and that §7.1 interleaves on `invocationId`, not just `messageId`. | Without this, tool calls from the second cycle show up under the wrong text segment. Add a test. |
| G10 | **Scroll-follow UX.** Not in the plan because it is a UI concern, but it is the single fastest way to make the feature feel broken on mobile. | §5.4. |
| G11 | **Stop button placement.** `ChatConversationView` has a single Send button in the input bar; replacing it with Stop while streaming is simple but worth spelling out so we do not accidentally ship a layout that shifts. | §9 step 7. |
| G12 | **Auth header on SSE.** §8.1 of the plan adds `X-Intella-Token` to `/api/*`. `URLSession.bytes` honors the default request headers, so this just works, but verify — some gateways strip custom headers on streaming responses. | Would fail silently with 401 in prod. |

None of these are blockers for Phase 2 as written; they are the
difference between "works" and "feels like Claude Code."

---

## 11. Acceptance criteria for the UI

### POC (steps 1–5 of §9)

- [ ] Sending a message that forces a `board` tool call streams text,
      then renders a single collapsed `● board` row, then more text, in
      order, without flicker.
- [ ] Expanding the row shows pretty-printed input/output and remains
      expanded across intervening streaming tokens.
- [ ] Scrolling up while streaming pauses auto-follow; a "↓ new" pill
      appears; tapping it resumes follow.
- [ ] Tool error renders red inline without killing the turn.

### Full (steps 6–9)

- [ ] Turn footer shows `<N> tokens · view run →`, and the link pushes
      the existing `InvocationDetailView` for that turn's invocation.
- [ ] Stop button aborts within 2s; invocation ends `status='cancelled'`;
      no orphan `running` rows.
- [ ] Re-opening a past session via `ChatHistoryView` renders tool steps
      inline, not just text.
- [ ] Backgrounding for 60s during a turn, then reopening, shows the
      completed turn reconstructed from the invocation snapshot.
- [ ] `ping` events every 15s; UI ignores them; no proxy drops observed
      over a 2-minute cold-path test.

### Cross-cutting

- [ ] No raw JSON appears in a collapsed row for `board`, `tasks`,
      `schedule`, `initiatives`, `goals`, `health`.
- [ ] `POST /api/chat` (buffered wrapper) still works; feature flag in
      iOS can fall back instantly.

---

## 12. Execution order

Summary of §9, threaded against the parent plan:

1. Build [CONTROL_LAYER_PLAN §5.1–§5.5](CONTROL_LAYER_PLAN.md#5-phase-2--in-process-agent-loop).
2. Add §7.2 cancel, §7.4 heartbeat to the same PR — trivial once the
   runner exists.
3. iOS: `ChatStream` + text-only streaming (POC step 2).
4. iOS: `ChatTurn` / `ChatSegment` refactor (POC step 3). Ship behind a
   feature flag.
5. Add §8 server-side presenters; iOS: collapsed tool rows (POC step 4).
6. iOS: expand-on-tap + footer + view-run link (POC steps 5–6).
7. iOS: stop button wired to §7.2 (POC step 7).
8. Ship §7.1 activity endpoint; iOS: history reconstruction (POC step 8).
9. iOS: background/reconnect polish (POC step 9).

Each step is a separable commit / PR. Do not bundle 3–9 together; the
value-per-risk ratio drops off a cliff past step 6 and it is easy to
spend two weeks polishing reconnect before the core UX is validated.
