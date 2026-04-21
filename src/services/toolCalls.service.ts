import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { toolCallLog } from '../db/schema.js';
import { notFound, now } from '../types/index.types.js';

export type ToolCallLog = typeof toolCallLog.$inferSelect;

export interface RecordToolCallStartInput {
  id: string;
  messageId: string;
  invocationId: string;
  toolName: string;
  input: unknown;
}

export interface RecordToolCallResultInput {
  output: unknown;
  isError: boolean;
  durationMs: number;
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
      endedAt: now(),
      durationMs: input.durationMs,
    })
    .where(eq(toolCallLog.id, id));

  const [updated] = await db.select().from(toolCallLog).where(eq(toolCallLog.id, id));
  return updated;
}
