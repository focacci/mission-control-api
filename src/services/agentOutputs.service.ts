import { and, asc, desc, eq, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { agentAssignments, agents, agentOutputs, agentOutputSteps } from '../db/schema.js';
import { appendEvidenceForInstant } from './briefs.service.js';
import {
  AppError,
  now,
  notFound,
  type AgentOutputStatus,
  type AppendAgentOutputStepInput,
  type CompleteAgentOutputInput,
  type CreateAgentOutputInput,
  type FailAgentOutputInput,
  type BriefAgentWorkItem,
} from '../types/index.types.js';

export type AgentOutput = typeof agentOutputs.$inferSelect;
export type AgentOutputStep = typeof agentOutputSteps.$inferSelect;

export interface AgentOutputDetail {
  output: AgentOutput;
  steps: AgentOutputStep[];
}

async function loadOutput(id: string): Promise<AgentOutput> {
  const [row] = await db.select().from(agentOutputs).where(eq(agentOutputs.id, id));
  if (!row) throw notFound('AgentOutput', id);
  return row;
}

export async function createAgentOutput(
  agentAssignmentId: string,
  input: CreateAgentOutputInput,
): Promise<AgentOutput> {
  const [aa] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, agentAssignmentId));
  if (!aa) throw notFound('AgentAssignment', agentAssignmentId);

  const row = {
    id: nanoid(),
    agentAssignmentId,
    agentId: input.agentId ?? aa.agentId ?? null,
    status: 'running' as AgentOutputStatus,
    input: input.input,
    response: null,
    model: input.model ?? null,
    tokensIn: 0,
    tokensOut: 0,
    startedAt: now(),
    endedAt: null,
    error: null,
  };

  await db.insert(agentOutputs).values(row);
  return loadOutput(row.id);
}

export async function appendAgentOutputStep(
  outputId: string,
  input: AppendAgentOutputStepInput,
): Promise<AgentOutputStep> {
  const output = await loadOutput(outputId);
  if (output.status !== 'running') {
    throw new AppError(409, `Cannot append step: output status is '${output.status}'`);
  }

  const [{ next }] = await db
    .select({ next: max(agentOutputSteps.sortOrder) })
    .from(agentOutputSteps)
    .where(eq(agentOutputSteps.outputId, outputId));
  const sortOrder = (next ?? -1) + 1;

  const startedAt = now();
  const base = {
    id: nanoid(),
    outputId,
    sortOrder,
    startedAt,
    endedAt: null as string | null,
    durationMs: null as number | null,
    content: null as string | null,
    toolName: null as string | null,
    toolInput: null as string | null,
    toolOutput: null as string | null,
    isError: false,
  };

  let row: typeof agentOutputSteps.$inferInsert;
  if (input.kind === 'thinking' || input.kind === 'text') {
    row = { ...base, kind: input.kind, content: input.content };
  } else {
    const startedMs = Date.parse(startedAt);
    const endedAt =
      input.durationMs !== undefined
        ? new Date(startedMs + input.durationMs).toISOString()
        : null;
    row = {
      ...base,
      kind: 'tool_call',
      toolName: input.toolName,
      toolInput: JSON.stringify(input.toolInput ?? null),
      toolOutput: input.toolOutput ?? null,
      isError: input.isError ?? false,
      durationMs: input.durationMs ?? null,
      endedAt,
    };
  }

  await db.insert(agentOutputSteps).values(row);
  const [inserted] = await db
    .select()
    .from(agentOutputSteps)
    .where(eq(agentOutputSteps.id, row.id!));
  return inserted;
}

export async function completeAgentOutput(
  outputId: string,
  input: CompleteAgentOutputInput,
): Promise<AgentOutput> {
  const output = await loadOutput(outputId);
  if (output.status !== 'running') {
    throw new AppError(409, `Cannot complete: output status is '${output.status}'`);
  }

  const endedAt = now();
  await db
    .update(agentOutputs)
    .set({
      status: 'complete',
      response: input.response,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      endedAt,
    })
    .where(eq(agentOutputs.id, outputId));

  const updated = await loadOutput(outputId);
  await recordAgentOutputBriefEvidence(updated, endedAt).catch(() => {
    // Brief evidence is best-effort — never block the agent runner on it.
  });
  return updated;
}

async function recordAgentOutputBriefEvidence(
  output: AgentOutput,
  endedAt: string,
): Promise<void> {
  let agentName: string | null = null;
  let agentEmoji: string | null = null;
  if (output.agentId) {
    const [agentRow] = await db.select().from(agents).where(eq(agents.id, output.agentId));
    agentName = agentRow?.identityName ?? agentRow?.name ?? null;
    agentEmoji = agentRow?.identityEmoji ?? null;
  }

  const [aa] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, output.agentAssignmentId));

  const startedMs = Date.parse(output.startedAt);
  const endedMs = Date.parse(endedAt);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs)
    ? Math.max(0, endedMs - startedMs)
    : null;

  const item: BriefAgentWorkItem = {
    kind: 'agent_work',
    agentOutputId: output.id,
    agentAssignmentId: output.agentAssignmentId,
    agentId: output.agentId ?? undefined,
    agentName: agentName ?? undefined,
    agentEmoji: agentEmoji ?? undefined,
    title: aa?.title ?? `Agent output ${output.id.slice(0, 6)}`,
    oneLineSummary: oneLine(output.response) ?? aa?.description ?? undefined,
    tokensIn: output.tokensIn,
    tokensOut: output.tokensOut,
    durationMs: durationMs ?? undefined,
    endedAt,
  };

  await appendEvidenceForInstant(endedAt, item);
}

function oneLine(text: string | null): string | undefined {
  if (!text) return undefined;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}

export async function failAgentOutput(
  outputId: string,
  input: FailAgentOutputInput,
): Promise<AgentOutput> {
  const output = await loadOutput(outputId);
  if (output.status !== 'running') {
    throw new AppError(409, `Cannot fail: output status is '${output.status}'`);
  }

  await db
    .update(agentOutputs)
    .set({
      status: input.status,
      error: input.error,
      endedAt: now(),
    })
    .where(eq(agentOutputs.id, outputId));

  return loadOutput(outputId);
}

export async function listAgentOutputsForAssignment(
  agentAssignmentId: string,
): Promise<AgentOutput[]> {
  const [aa] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, agentAssignmentId));
  if (!aa) throw notFound('AgentAssignment', agentAssignmentId);

  return db
    .select()
    .from(agentOutputs)
    .where(eq(agentOutputs.agentAssignmentId, agentAssignmentId))
    .orderBy(desc(agentOutputs.startedAt));
}

/**
 * List every agent output across all assignments, newest first by `startedAt`.
 */
export async function listAllAgentOutputs(): Promise<AgentOutput[]> {
  return db
    .select()
    .from(agentOutputs)
    .orderBy(desc(agentOutputs.startedAt));
}

export async function getAgentOutput(outputId: string): Promise<AgentOutputDetail> {
  const output = await loadOutput(outputId);
  const steps = await db
    .select()
    .from(agentOutputSteps)
    .where(eq(agentOutputSteps.outputId, outputId))
    .orderBy(asc(agentOutputSteps.sortOrder));
  return { output, steps };
}

export async function deleteAgentOutput(outputId: string): Promise<void> {
  const output = await loadOutput(outputId);
  await db.delete(agentOutputs).where(eq(agentOutputs.id, output.id));
}

export { and };
