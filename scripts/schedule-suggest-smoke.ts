#!/usr/bin/env tsx
/**
 * schedule.suggest end-to-end smoke (IOS_MESSAGE_PARTS_PLAN §8 step 10).
 *
 * Drives a real chat round-trip against a running mission-control-api and
 * verifies the chip-tap → schedule.assign loop the iOS QuickReplyChipBar
 * relies on:
 *
 *   1. Pick (or create) an agent assignment to schedule.
 *   2. Create a fresh session bound to that assignment.
 *   3. Turn 1 — ask the agent to find a slot for the assignment.
 *      Assert: response `parts` carries a `quick_replies` part with
 *      ≥ 1 suggestion. Assert: the invocation's toolCalls include
 *      `mission-control__schedule` (action `suggest`) and
 *      `mission-control__suggest_replies`.
 *   4. Turn 2 — submit the first chip's id as a synthetic user message
 *      (this is what `submitQuickReply` sends from iOS on tap).
 *      Assert: invocation's toolCalls include
 *      `mission-control__schedule` with `action: "assign"` and the
 *      chip's id as the assigned slot.
 *
 * Run with:  API_BASE=http://localhost:5050 tsx scripts/schedule-suggest-smoke.ts
 */

const API_BASE = process.env.API_BASE ?? 'http://localhost:5050';
const TURN_TIMEOUT_MS = 90_000;
const SCHEDULE_TOOL = 'mission-control__schedule';
const SUGGEST_REPLIES_TOOL = 'mission-control__suggest_replies';

function ok(msg: string) {
  console.log(`✓ ${msg}`);
}
function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface MessagePart {
  kind: string;
  // text
  text?: string;
  // quick_replies
  suggestions?: Array<{ id: string; label: string }>;
  // card / navigate / attachment fields not used here
  [k: string]: unknown;
}

interface ChatResponse {
  reply: string;
  parts: MessagePart[];
  sessionId: string;
  agentId: string;
  invocationId: string;
}

interface ToolCallLog {
  id: string;
  toolName: string;
  inputJson: string | null;
  outputJson: string | null;
  startedAt: string;
}

interface InvocationDetail {
  invocation: { id: string; status: string };
  messages: Array<{ id: string; role: string }>;
  toolCalls: ToolCallLog[];
}

interface AgentAssignment {
  id: string;
  title: string;
  isDone?: boolean;
}

interface MCTask {
  id: string;
  name: string;
  agentAssignments?: AgentAssignment[];
  isDone?: boolean;
}

// ---------------------------------------------------------------------------
// Setup — find a usable agent assignment, or create one.
// ---------------------------------------------------------------------------

async function ensureAgentAssignment(): Promise<{ task: MCTask; assignment: AgentAssignment }> {
  const tasks = await api<MCTask[]>('/api/tasks');
  for (const task of tasks) {
    if (task.isDone) continue;
    const aa = (task.agentAssignments ?? []).find(a => !a.isDone);
    if (aa) {
      ok(`reusing assignment "${aa.title}" on task "${task.name}"`);
      return { task, assignment: aa };
    }
  }

  // No reusable assignment — make one.
  const task = await api<MCTask>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: `[smoke] schedule-suggest task ${Date.now()}`,
      objective: 'Smoke test fixture for schedule.suggest end-to-end',
      emoji: '🧪',
    }),
  });

  const assignment = await api<AgentAssignment>(
    `/api/tasks/${task.id}/agent-assignments`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: '[smoke] dry-run draft outline',
        description:
          'Synthetic agent assignment created by schedule-suggest-smoke.ts; safe to delete.',
      }),
    },
  );
  ok(`created fixture task ${task.id} with assignment ${assignment.id}`);
  return { task, assignment };
}

// ---------------------------------------------------------------------------
// Chat round-trip helpers
// ---------------------------------------------------------------------------

async function sendChat(opts: {
  message: string;
  sessionId?: string;
  contextType: string;
  contextId: string;
}): Promise<ChatResponse> {
  const body = {
    message: opts.message,
    sessionId: opts.sessionId,
    context: {
      type: opts.contextType,
      id: opts.contextId,
    },
  };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TURN_TIMEOUT_MS);
  try {
    return await api<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

function quickReplyPart(parts: MessagePart[]): MessagePart | undefined {
  return parts.find(p => p.kind === 'quick_replies');
}

function toolCallsByName(calls: ToolCallLog[], name: string): ToolCallLog[] {
  return calls.filter(c => c.toolName === name);
}

function parseInputJson(call: ToolCallLog): Record<string, unknown> {
  if (!call.inputJson) return {};
  try {
    return JSON.parse(call.inputJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

async function main() {
  // Health probe so we fail fast with a clear error when the API isn't up.
  try {
    await api<{ status: string }>('/api/health');
  } catch (e: any) {
    fail(`API at ${API_BASE} unreachable: ${e.message}`);
  }
  ok(`API reachable at ${API_BASE}`);

  const { assignment } = await ensureAgentAssignment();

  const session = await api<{ id: string }>('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({
      agentId: 'intella',
      contextType: 'agent_assignment',
      contextId: assignment.id,
      title: '[smoke] schedule.suggest flow',
    }),
  });
  ok(`opened fresh session ${session.id}`);

  // -------------------------------------------------------------------------
  // Turn 1 — agent should suggest candidate slots and surface chips.
  // -------------------------------------------------------------------------
  const turn1Prompt =
    `Find me a good slot to schedule "${assignment.title}". ` +
    `Use schedule.suggest to get candidate slots, then offer the top 3 as ` +
    `tap-to-send chips via suggest_replies. Each chip's id MUST be the ` +
    `slotId from the schedule.suggest result so I can tap one to assign.`;

  const turn1 = await sendChat({
    message: turn1Prompt,
    sessionId: session.id,
    contextType: 'agent_assignment',
    contextId: assignment.id,
  });
  ok(`turn 1 returned (invocation ${turn1.invocationId})`);

  if (!Array.isArray(turn1.parts) || turn1.parts.length === 0) {
    fail(`turn 1 response missing parts[]; got ${JSON.stringify(turn1).slice(0, 400)}`);
  }
  const chipsPart = quickReplyPart(turn1.parts);
  if (!chipsPart || !Array.isArray(chipsPart.suggestions) || chipsPart.suggestions.length === 0) {
    fail(
      `turn 1 missing quick_replies part with ≥1 suggestion. parts=` +
        JSON.stringify(turn1.parts).slice(0, 600),
    );
  }
  ok(`turn 1 carries ${chipsPart.suggestions!.length} quick_replies chip(s)`);

  const detail1 = await api<InvocationDetail>(`/api/invocations/${turn1.invocationId}`);
  const scheduleCalls1 = toolCallsByName(detail1.toolCalls, SCHEDULE_TOOL);
  const suggestCall = scheduleCalls1.find(c => parseInputJson(c).action === 'suggest');
  if (!suggestCall) {
    fail(
      `turn 1 invocation never called ${SCHEDULE_TOOL} with action=suggest. ` +
        `tools=${detail1.toolCalls.map(t => t.toolName).join(',')}`,
    );
  }
  ok(`turn 1 called ${SCHEDULE_TOOL} action=suggest`);

  if (toolCallsByName(detail1.toolCalls, SUGGEST_REPLIES_TOOL).length === 0) {
    fail(`turn 1 invocation never called ${SUGGEST_REPLIES_TOOL}`);
  }
  ok(`turn 1 called ${SUGGEST_REPLIES_TOOL}`);

  // -------------------------------------------------------------------------
  // Turn 2 — synthetic chip tap. iOS submits the chip's `label` as the user
  // bubble and the `id` is what the agent should map back to a slot. Per
  // IOS_MESSAGE_PARTS_PLAN §7, sending the id as text works today since the
  // agent reads it verbatim; once prompt_user lands the round-trip becomes a
  // typed `prompt_reply` instead.
  // -------------------------------------------------------------------------
  const chip = chipsPart.suggestions![0];
  const turn2Prompt =
    `I tapped the chip with id "${chip.id}" (label "${chip.label}"). ` +
    `Assign that slot to this agent assignment via schedule.assign and ` +
    `confirm in one short sentence.`;

  const turn2 = await sendChat({
    message: turn2Prompt,
    sessionId: session.id,
    contextType: 'agent_assignment',
    contextId: assignment.id,
  });
  ok(`turn 2 returned (invocation ${turn2.invocationId})`);

  const detail2 = await api<InvocationDetail>(`/api/invocations/${turn2.invocationId}`);
  const scheduleCalls2 = toolCallsByName(detail2.toolCalls, SCHEDULE_TOOL);
  const assignCall = scheduleCalls2.find(c => parseInputJson(c).action === 'assign');
  if (!assignCall) {
    fail(
      `turn 2 invocation never called ${SCHEDULE_TOOL} with action=assign. ` +
        `tools=${detail2.toolCalls.map(t => t.toolName).join(',')}`,
    );
  }
  const assignArgs = parseInputJson(assignCall);
  if (assignArgs.slotId !== chip.id) {
    fail(
      `turn 2 schedule.assign used slotId=${JSON.stringify(assignArgs.slotId)} ` +
        `but the tapped chip was ${JSON.stringify(chip.id)}`,
    );
  }
  ok(`turn 2 called ${SCHEDULE_TOOL} action=assign with the tapped slotId`);

  console.log(`\nschedule.suggest smoke: PASS — chip-tap → assign round-trip works.`);
}

main().catch(err => {
  fail(`unhandled: ${err instanceof Error ? err.message : String(err)}`);
});
