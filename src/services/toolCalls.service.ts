import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { toolCallLog } from '../db/schema.js';
import { notFound, now } from '../types/index.types.js';

export type ToolCallLog = typeof toolCallLog.$inferSelect;

export interface RecordToolCallStartInput {
  id: string;
  /**
   * The assistant `chat_messages` row that emitted this tool call. May be
   * null when `tool.start` arrives before any assistant text in the block;
   * backfill via `backfillToolCallMessageIds` once the message row exists.
   */
  messageId: string | null;
  invocationId: string;
  toolName: string;
  input: unknown;
}

export interface RecordToolCallResultInput {
  output: unknown;
  isError: boolean;
  durationMs: number;
  summary?: string | null;
}

export async function recordToolCallStart(input: RecordToolCallStartInput): Promise<ToolCallLog> {
  const row: ToolCallLog = {
    id: input.id,
    messageId: input.messageId,
    invocationId: input.invocationId,
    toolName: input.toolName,
    input: JSON.stringify(input.input ?? null),
    output: null,
    isError: false,
    summary: null,
    startedAt: now(),
    endedAt: null,
    durationMs: null,
  };
  await db.insert(toolCallLog).values(row);
  return row;
}

export async function recordToolCallResult(
  id: string,
  input: RecordToolCallResultInput,
): Promise<ToolCallLog> {
  const [existing] = await db.select().from(toolCallLog).where(eq(toolCallLog.id, id));
  if (!existing) throw notFound('ToolCall', id);

  await db
    .update(toolCallLog)
    .set({
      output: JSON.stringify(input.output ?? null),
      isError: input.isError,
      summary: input.summary ?? null,
      endedAt: now(),
      durationMs: input.durationMs,
    })
    .where(eq(toolCallLog.id, id));

  const [updated] = await db.select().from(toolCallLog).where(eq(toolCallLog.id, id));
  return updated;
}

/**
 * Attach `messageId` to any tool_call_log rows for `invocationId` that were
 * recorded before the assistant block's `chat_messages` row existed. Called
 * by the runner on `message_complete`.
 */
export async function backfillToolCallMessageIds(
  invocationId: string,
  messageId: string,
): Promise<void> {
  await db
    .update(toolCallLog)
    .set({ messageId })
    .where(
      and(eq(toolCallLog.invocationId, invocationId), isNull(toolCallLog.messageId)),
    );
}
