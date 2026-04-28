import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { agentInvocations, pendingMessageParts } from '../db/schema.js';
import { AppError, now, type MessagePart } from '../types/index.types.js';

export type PendingPartRow = typeof pendingMessageParts.$inferSelect;

/**
 * Resolve the in-flight invocation for a chat session. Bucket 2b interface
 * tools (render_card, suggest_replies, navigate, attach) execute inside the
 * stdio MCP server, which only knows the `sessionId` the agent passed in. We
 * still need to anchor each emitted part on the runner's current invocation —
 * the most recent `running` row for the session is that anchor.
 */
export async function getActiveInvocationId(sessionId: string): Promise<string> {
  const [row] = await db
    .select({ id: agentInvocations.id })
    .from(agentInvocations)
    .where(
      and(
        eq(agentInvocations.sessionId, sessionId),
        eq(agentInvocations.status, 'running'),
      ),
    )
    .orderBy(desc(agentInvocations.startedAt))
    .limit(1);
  if (!row) {
    throw new AppError(
      400,
      `No running invocation for session ${sessionId} — interface tools require an in-flight chat turn.`,
    );
  }
  return row.id;
}

/**
 * Append a structured part to the queue for the session's in-flight assistant
 * message. The runner drains every queued part for an invocation when it
 * flushes the assistant buffer (see `runner.ts::flushAssistantBuffer`),
 * merging them after any buffered text into the persisted `chat_messages.parts`.
 */
export async function enqueuePart(
  sessionId: string,
  part: MessagePart,
): Promise<{ invocationId: string; partId: string }> {
  const invocationId = await getActiveInvocationId(sessionId);

  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number | null>`MAX(${pendingMessageParts.sortOrder})` })
    .from(pendingMessageParts)
    .where(eq(pendingMessageParts.invocationId, invocationId));
  const nextOrder = (maxOrder ?? -1) + 1;

  const id = nanoid();
  await db.insert(pendingMessageParts).values({
    id,
    invocationId,
    sessionId,
    part,
    sortOrder: nextOrder,
    createdAt: now(),
  });
  return { invocationId, partId: id };
}

/**
 * Pull every queued part for the given invocation in insertion order, deleting
 * them as the caller takes ownership. Used by the runner at flush time so a
 * single transcript message carries both the buffered assistant text and any
 * interface-tool parts emitted while it was producing that turn.
 */
export async function drainParts(invocationId: string): Promise<MessagePart[]> {
  const rows = await db
    .select()
    .from(pendingMessageParts)
    .where(eq(pendingMessageParts.invocationId, invocationId))
    .orderBy(asc(pendingMessageParts.sortOrder));
  if (rows.length === 0) return [];
  await db
    .delete(pendingMessageParts)
    .where(eq(pendingMessageParts.invocationId, invocationId));
  return rows.map(r => r.part as MessagePart);
}
