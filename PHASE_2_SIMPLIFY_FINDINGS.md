# Phase 2 API — Simplification & Cohesion Findings

> Review performed 2026-04-23 after slices 1–4 of [PHASE_2_API_PLAN.md](PHASE_2_API_PLAN.md)
> landed. Slices 5–9 are still open. These notes are the backlog of cleanups
> worth bundling with slice 5, or handling in a short dedicated pass before it.
>
> Written for an agent that hasn't seen the conversation that produced it.
> Each finding includes **where**, **why it matters**, and **what to do**.

## Contents

- [1. Context](#1-context)
- [2. Findings](#2-findings)
  - [F1 — Slice 1–4 plumbing is dormant (blocking)](#f1--slice-14-plumbing-is-dormant-blocking)
  - [F2 — systemPrompt always clobbers SOUL.md (bug)](#f2--systemprompt-always-clobbers-soulmd-bug)
  - [F3 — Context leaks into user message rows](#f3--context-leaks-into-user-message-rows)
  - [F4 — chat MCP tool imports the service we're deleting](#f4--chat-mcp-tool-imports-the-service-were-deleting)
  - [F5 — Gateway default scopes include `operator.admin`](#f5--gateway-default-scopes-include-operatoradmin)
  - [F6 — Default model string is out of date](#f6--default-model-string-is-out-of-date)
  - [F7 — Runner is one 450-line file](#f7--runner-is-one-450-line-file)
  - [F8 — `classifyErrorCode` is a fragile string match](#f8--classifyerrorcode-is-a-fragile-string-match)
  - [F9 — `getTodayTokenUsage` uses UTC, not local day](#f9--gettodaytokenusage-uses-utc-not-local-day)
- [3. iOS-side follow-ups already landed](#3-ios-side-follow-ups-already-landed)
- [4. Suggested batching](#4-suggested-batching)

---

## 1. Context

Slices 1–4 shipped the in-process Gateway WS client, MCP bridge, and runner,
but **no live traffic flows through any of it yet**. [chat.routes.ts](src/routes/chat.routes.ts)
still calls the legacy [chat.service.ts](src/services/chat.service.ts), which
shells out to `openclaw agent --json` via `execFile`. Slice 5 deletes that
service and rewires `POST /api/chat` onto [handleChatTurn](src/agent/chatOrchestrator.ts).
That's the unlock — most of the items below are worth addressing as part of
that PR, since they're in code paths slice 5 touches anyway.

Anchor files:

- [src/agent/runner.ts](src/agent/runner.ts)
- [src/agent/chatOrchestrator.ts](src/agent/chatOrchestrator.ts)
- [src/agent/gatewayClient.ts](src/agent/gatewayClient.ts)
- [src/agent/systemPrompt.ts](src/agent/systemPrompt.ts)
- [src/agent/mcpBridge.ts](src/agent/mcpBridge.ts)
- [src/services/chat.service.ts](src/services/chat.service.ts) *(to be deleted in slice 5)*
- [src/services/invocations.service.ts](src/services/invocations.service.ts)

---

## 2. Findings

### F1 — Slice 1–4 plumbing is dormant (blocking)

**Where:** [src/routes/chat.routes.ts](src/routes/chat.routes.ts) calls
`chatService.sendMessage`; nothing else in the request path references
`handleChatTurn`, `runner.run`, or the gateway singleton.

**Why it matters:** Every bug, latency, and cost improvement baked into slices
1–4 is invisible to users until `/api/chat` is rewired. `tool_call_log` stays
empty for all traffic. `agent_invocations.gatewayRunId` stays NULL. Token
counts on invocations stay at 0 (see [chat.service.ts:149](src/services/chat.service.ts#L149)).
Presenters go unused. The "gateway down" failure mode is unreachable because
we never touch the gateway.

**What to do:** Land slice 5 (~50 LOC). Replace the body of
[chat.service.ts:sendMessage](src/services/chat.service.ts#L115) with a call
to `handleChatTurn`, accumulating `text_delta`s into the reply string and
capturing `invocationId` + token totals from the final events. Then delete
`chat.service.ts` entirely and have [chat.routes.ts](src/routes/chat.routes.ts)
call `handleChatTurn` directly. Response shape stays `{ reply, sessionId, agentId, invocationId }`.

Verify iOS still decodes: the Swift `ChatService.send` in
`mission-control-ios/MissionControl/Views/FloatingChat/ChatConversationView.swift`
now reads `invocationId` from the response — it was added in the 2026-04-23
UI pass alongside these findings.

---

### F2 — systemPrompt always clobbers SOUL.md (bug)

**Where:** [src/agent/runner.ts:201](src/agent/runner.ts#L201) —
```ts
const systemPrompt = buildSystemPrompt(params.agentId, params.systemPromptAdditions);
…
rpcParams.systemPrompt = systemPrompt;  // always set
```

**Why it matters:** [systemPrompt.ts](src/agent/systemPrompt.ts) has an
explicit JSDoc warning:

> Passing a non-empty string as `systemPrompt` on the `agent` RPC replaces
> OpenClaw's resolved prompt wholesale; we avoid that by keeping this layer
> *additive* at the call site — callers that want the gateway's default
> prompt pass `undefined` instead of the output of this function.

The runner violates this contract. Every turn sends a minimal prompt
(`"Today is … You are agent `intella`…"`) and drops the gateway's
SOUL.md + bootstrap context. The agent loses personality, tool guidance, and
whatever Phase 3 context the gateway was going to inject.

**What to do:** In `runner.ts`, only build and pass `systemPrompt` when
`params.systemPromptAdditions` is a non-empty string. When it's absent, omit
`systemPrompt` from `rpcParams` so the gateway uses its resolved prompt.

Alternative if the gateway has no convenient "append" mechanism: change the
`agent` RPC to accept `systemPromptAppend` instead — but that's an OpenClaw
change, out of scope here. Start with the first approach.

Add a fixture test that confirms `rpcParams.systemPrompt` is absent when
`systemPromptAdditions` is undefined.

---

### F3 — Context leaks into user message rows

**Where:** [src/agent/chatOrchestrator.ts:63-75](src/agent/chatOrchestrator.ts#L63-L75)
— `buildUserMessage` prepends a `[Context: viewing tasks "Ship brief" …]`
line to the user's text, then stores the combined string as the
`chat_messages.content` row via [appendMessage](src/services/conversations.service.ts#L150).

**Why it matters:** Every time a past session is re-rendered in iOS, user
bubbles show the bracketed context prefix. That's noise — the user typed
only the part after the newline. It also bloats `chat_messages.content`
permanently, so storage cost grows with context mentions.

**What to do:** Pass context to the agent via `systemPromptAdditions`
(Phase 3's hook — empty today) instead of concatenating it onto the user
message. Persist only the user's real text in `chat_messages`. Pass both to
`runner.run`:

```ts
run({
  …,
  initialUserMessage: params.message,              // raw user text
  systemPromptAdditions: formatContext(params.context),  // context line(s)
});
```

Requires coordinating with F2 — once `systemPrompt` is only set when
additions exist, context is the first real caller.

---

### F4 — chat MCP tool imports the service we're deleting

**Where:** [src/agent/mcpBridge.ts:16](src/agent/mcpBridge.ts#L16) imports
`chatService` from `../services/chat.service.js`. There's a `chat` tool in
the MCP catalog that dispatches to it.

**Why it matters:** Slice 5 deletes `chat.service.ts`. The bridge breaks
unless the `chat` tool is also removed or rewritten.

**What to do:** Remove the `chat` tool from
[mcpBridge.ts's TOOLS list](src/agent/mcpBridge.ts) and the import. A
nested-agent "chat with intella from inside an intella tool call" tool was
always weird; drop it. If some workflow relies on it, the replacement is a
dedicated `agent.invoke` style surface, not another MCP tool — defer.

Update [mcpBridge.ts's dispatch](src/agent/mcpBridge.ts) switch and the list
in [docs: tool catalog](src/db/SCHEMAS.md) / [MCP tests](scripts/mcp-tools-smoke.ts)
so the tool count drops from 14 to 13.

---

### F5 — Gateway default scopes include `operator.admin`

**Where:** [src/agent/gatewayClient.ts:382](src/agent/gatewayClient.ts#L382) —
```ts
scopes: this.opts.scopes ?? ['operator.admin', 'operator.read', 'operator.write'],
```

**Why it matters:** [PHASE_2_API_PLAN.md §6.3](PHASE_2_API_PLAN.md#63-srcagentgatewayclientts-new--replaces-63-of-the-old-plan)
specifies `['operator.read', 'operator.write']`. Mission Control has no
reason to ask for admin — it reads state and drives agent turns. Over-scoping
breaks least-privilege when device pairing lands in slice 4 (already noted in
[MEMORY: gateway_scopes_pairing](memory/project_gateway_scopes.md)).

Also: today the shared-token path ignores requested scopes anyway, so this is
latent — it'll bite the day pairing goes live.

**What to do:** Drop `'operator.admin'` from the default. Also update
[src/index.ts](src/index.ts) if it passes explicit scopes (it doesn't today).

---

### F6 — Default model string is out of date

**Where:**

- [src/agent/chatOrchestrator.ts:15](src/agent/chatOrchestrator.ts#L15)
  — `process.env.AGENT_DEFAULT_MODEL ?? 'claude-opus-4-6'`
- [src/services/chat.service.ts:20](src/services/chat.service.ts#L20) — same

**Why it matters:** Latest Claude model family is 4.7 (Opus 4.7:
`claude-opus-4-7`, Sonnet 4.6: `claude-sonnet-4-6`, Haiku 4.5:
`claude-haiku-4-5-20251001`). The hard-coded fallback runs an older model
whenever `AGENT_DEFAULT_MODEL` isn't set.

**What to do:** Per [PHASE_2_API_PLAN §11.2](PHASE_2_API_PLAN.md#11-open-decisions),
the right move is *not* to hard-code a default at all — let the per-agent
config in OpenClaw drive the model, and only pass `model` through when iOS
explicitly asks. Drop `DEFAULT_MODEL` from the orchestrator and stop
populating `invocations.model` from it (or populate with `'<agent-default>'`
as a placeholder — the gateway sends back the actual model in its lifecycle
events, so overwriting from there is better).

If a default must remain as a guardrail, use `claude-sonnet-4-6` — cheaper
and fast enough for chat; Opus is better reserved for explicit heavy work.

---

### F7 — Runner is one 450-line file

**Where:** [src/agent/runner.ts](src/agent/runner.ts) does four jobs in one
module:

1. Gateway lifecycle (subscribe, dispatch RPC, settle).
2. Prelude buffering + queue serialization (~30 LOC of promise-chain
   plumbing).
3. Event normalization (`normalizeGatewayEvent`).
4. Reducer (`reduce` + helpers).

**Why it matters:** Not urgent — the code works. But the fixture test will
want to import `reduce` + `normalizeGatewayEvent` without spinning up the
gateway wrapper, and today it imports everything. Splitting lowers the
cognitive load when future slices (F2, F3) modify the orchestration part
without touching the reducer.

**What to do (optional, bundle with F2/F3):**

- Move `reduce`, `ReducerState`, `normalizeGatewayEvent`, and the private
  helpers (`applyTokens`, `classifyErrorCode`, `flushAssistantBuffer`, field
  accessors) to `src/agent/runner/reduce.ts`.
- Keep `run()` + `RunAgentParams` / `RunAgentResult` / `RunnerOptions` /
  `RunnerGateway` in `src/agent/runner.ts`.
- Re-export the reducer names from the module index so external imports
  don't change.

Don't do this if F2/F3 don't land — churn for its own sake.

---

### F8 — `classifyErrorCode` is a fragile string match

**Where:** [src/agent/runner.ts:433-438](src/agent/runner.ts#L433-L438) —
```ts
if (lower.includes('abort') || lower.includes('cancel')) return 'cancelled';
if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
return 'agent';
```

**Why it matters:** The gateway's `lifecycle.error` payload carries a
structured `code` field in addition to the human message (per [docs: Agent Loop](https://docs.openclaw.ai/concepts/agent-loop)).
We throw that away and regex-match the human string, so rewording a gateway
error message silently breaks our status classification. Cancel-vs-timeout
is a user-visible distinction on invocation rows.

**What to do:** Inspect `evt.data.code` (or whichever field the gateway
actually uses) first; fall back to string matching only as a last resort.
Before editing, verify the gateway payload shape against a real
`lifecycle.error` event — the docs and actual emission may diverge. A smoke
test that deliberately triggers timeout + cancel and asserts the invocation
ends in the right status is the forcing function here.

---

### F9 — `getTodayTokenUsage` uses UTC, not local day

**Where:** [src/services/invocations.service.ts:185-198](src/services/invocations.service.ts#L185-L198)
uses `setUTCHours(0, 0, 0, 0)` while the rest of the codebase uses
[CLAUDE.md convention](CLAUDE.md) — `today()` returns `YYYY-MM-DD` in
America/New_York.

**Why it matters:** The comment on line 182 says
"local calendar day in America/New_York, matching `today()`", but the code
uses UTC. In the 4-hour window each day between midnight ET and midnight
UTC, the cap resets early (or late) relative to the rest of the app. For a
single-user system this is mostly cosmetic — but it means the "daily" cap
silently resets at 8 PM ET in winter / 7 PM ET in summer.

**What to do:** Either:

1. Compute the day boundary from `today()` explicitly — parse `today()` into
   an ET midnight ISO string and use that as the `since` filter. Matches the
   comment.
2. Or accept UTC and update the comment to say so.

Pick (1) — it's consistent with the rest of the date handling and matches
the plan's intent.

---

## 3. iOS-side follow-ups already landed

For cross-reference when slice 5 lands, the iOS app was updated on
2026-04-23 to match the Phase 2 server contract:

- `Shared/Models/AgentInvocation.swift` — added `AgentInvocation.gatewayRunId`;
  added `ToolCallLog.summary`; made `ToolCallLog.messageId` optional.
- `Shared/Models/ServerHealth.swift` — added nested `ServerHealth.Gateway`
  (connected / lastHelloAt / deviceTokenPresent).
- `ChatConversationView.swift` / `AgentChatView.swift` — `ChatMessage` carries
  `invocationId` on assistant bubbles; `ChatService.send` returns it; history
  rehydration preserves it from `ChatTranscriptMessage.invocationId`.
- `MessageBubble` renders a "View run ↗" link under agent bubbles that pushes
  `InvocationDetailView`.
- `InvocationDetailView` renders tool calls via a new `ToolCallRow`
  (collapsed with summary · toolName · durationMs; expand to see raw
  input/output JSON); surfaces `gatewayRunId` on metadata.

Once slice 5 ships and `invocationId` starts being a live handle into
tool_call_log data, these UI paths start showing real data with zero further
changes.

---

## 4. Suggested batching

If picking these up as a single PR stack:

| PR | Findings | Notes |
|----|----------|-------|
| 1  | F1 + F2 + F4 | Slice 5 landing, with the systemPrompt bug fix and the dead-tool cleanup folded in since they're in the code paths being rewired. |
| 2  | F3 | Context-as-system-prompt-addition. Requires F2 first. |
| 3  | F5 + F6 + F9 | Small, independent config/correctness fixes. Could ride in PR 1 if appetite allows. |
| 4  | F7 | Optional refactor. Skip unless the fixture test in slice 4 (still open per §10) wants the cleaner import surface. |
| 5  | F8 | Bundle with whatever slice adds the first real cancel/timeout integration test. |

Everything else in [PHASE_2_API_PLAN §9](PHASE_2_API_PLAN.md#9-pr-sized-execution-slices)
(slices 6–9: SSE, cancel, activity, auth) is out of scope for this cleanup —
those are net-new features, not simplifications.
