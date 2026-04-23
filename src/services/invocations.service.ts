import { and, asc, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import {
  agentInvocations,
  chatMessages,
  toolCallLog,
} from '../db/schema.js';
import { AppError, notFound, now } from '../types/index.types.js';

export type AgentInvocation = typeof agentInvocations.$inferSelect;

export type InvocationTrigger = AgentInvocation['trigger'];
export type InvocationStatus = AgentInvocation['status'];

export interface StartInvocationInput {
  trigger: InvocationTrigger;
  triggerRefId?: string | null;
  agentId: string;
  sessionId: string;
  model: string;
  gatewayRunId?: string | null;
}

export interface CompleteInvocationInput {
  tokensIn: number;
  tokensOut: number;
}

export interface FailInvocationInput {
  error: string;
  status?: Extract<InvocationStatus, 'error' | 'timeout' | 'cancelled'>;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ListInvocationsOpts {
  limit?: number;
  trigger?: InvocationTrigger;
  status?: InvocationStatus;
  since?: string;
}

export async function startInvocation(input: StartInvocationInput): Promise<AgentInvocation> {
  const row: AgentInvocation = {
    id: nanoid(),
    trigger: input.trigger,
    triggerRefId: input.triggerRefId ?? null,
    agentId: input.agentId,
    sessionId: input.sessionId,
    status: 'running',
    model: input.model,
    startedAt: now(),
    endedAt: null,
    error: null,
    tokensIn: 0,
    tokensOut: 0,
    gatewayRunId: input.gatewayRunId ?? null,
  };
  await db.insert(agentInvocations).values(row);
  return row;
}

/**
 * Attach the gateway `runId` returned by the `agent` RPC to an already-started
 * invocation. The runner calls this immediately after the RPC resolves so the
 * correlation is available to `/api/invocations/:id` readers even mid-turn.
 */
export async function setInvocationRunId(
  id: string,
  gatewayRunId: string,
): Promise<void> {
  await db
    .update(agentInvocations)
    .set({ gatewayRunId })
    .where(eq(agentInvocations.id, id));
}

export async function completeInvocation(
  id: string,
  input: CompleteInvocationInput,
): Promise<AgentInvocation> {
  const [existing] = await db
    .select()
    .from(agentInvocations)
    .where(eq(agentInvocations.id, id));
  if (!existing) throw notFound('AgentInvocation', id);

  await db
    .update(agentInvocations)
    .set({
      status: 'complete',
      endedAt: now(),
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      error: null,
    })
    .where(eq(agentInvocations.id, id));

  const [updated] = await db
    .select()
    .from(agentInvocations)
    .where(eq(agentInvocations.id, id));
  return updated;
}

export async function failInvocation(
  id: string,
  input: FailInvocationInput,
): Promise<AgentInvocation> {
  const [existing] = await db
    .select()
    .from(agentInvocations)
    .where(eq(agentInvocations.id, id));
  if (!existing) throw notFound('AgentInvocation', id);

  const updates: Partial<AgentInvocation> = {
    status: input.status ?? 'error',
    endedAt: now(),
    error: input.error,
  };
  if (typeof input.tokensIn === 'number') updates.tokensIn = input.tokensIn;
  if (typeof input.tokensOut === 'number') updates.tokensOut = input.tokensOut;

  await db.update(agentInvocations).set(updates).where(eq(agentInvocations.id, id));

  const [updated] = await db
    .select()
    .from(agentInvocations)
    .where(eq(agentInvocations.id, id));
  return updated;
}

export async function listInvocations(
  opts: ListInvocationsOpts = {},
): Promise<AgentInvocation[]> {
  const conditions: SQL[] = [];
  if (opts.trigger) conditions.push(eq(agentInvocations.trigger, opts.trigger));
  if (opts.status) conditions.push(eq(agentInvocations.status, opts.status));
  if (opts.since) conditions.push(gte(agentInvocations.startedAt, opts.since));

  const limit = opts.limit ?? 50;

  return db
    .select()
    .from(agentInvocations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(agentInvocations.startedAt))
    .limit(limit);
}

export interface InvocationDetail {
  invocation: AgentInvocation;
  messages: (typeof chatMessages.$inferSelect)[];
  toolCalls: (typeof toolCallLog.$inferSelect)[];
}

export async function getInvocation(id: string): Promise<InvocationDetail> {
  const [invocation] = await db
    .select()
    .from(agentInvocations)
    .where(eq(agentInvocations.id, id));
  if (!invocation) throw notFound('AgentInvocation', id);

  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.invocationId, id))
    .orderBy(asc(chatMessages.sortOrder));

  const toolCalls = await db
    .select()
    .from(toolCallLog)
    .where(eq(toolCallLog.invocationId, id))
    .orderBy(asc(toolCallLog.startedAt));

  return { invocation, messages, toolCalls };
}

/**
 * Sum tokensIn + tokensOut for all invocations started today (local calendar
 * day in America/New_York, matching `today()`). Used to enforce
 * AGENT_DAILY_TOKEN_CAP in Phase 2.
 */
export async function getTodayTokenUsage(): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const sinceIso = startOfDay.toISOString();

  const [{ total }] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${agentInvocations.tokensIn} + ${agentInvocations.tokensOut}), 0)`,
    })
    .from(agentInvocations)
    .where(gte(agentInvocations.startedAt, sinceIso));

  return total;
}

export function ensureRunning(invocation: AgentInvocation): void {
  if (invocation.status !== 'running') {
    throw new AppError(409, `Invocation ${invocation.id} is not running (status=${invocation.status})`);
  }
}
