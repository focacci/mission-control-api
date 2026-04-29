
## Intella MCP — Render Cards Rule

**Always call `render_card` inline when a response references a renderable entity.**

Renderable types: `goal`, `initiative`, `task`, `agent_assignment`, `slot`, `schedule_day`

- Call `render_card` with `sessionId`, `cardType`, and `entityId` for each entity mentioned
- Do this *before or alongside* your text response — not after
- When listing multiple entities (e.g. all goals), render all of them in one pass
- Use `sessionId` from the active session context (`qNcp50D3jxX_r1PBw5xpW` for the current main session — but always prefer the runtime-provided session ID)

**Why:** The Intella UI can render rich interactive cards inline. Plain text references are a degraded experience when a card exists.
