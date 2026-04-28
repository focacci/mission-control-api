import { and, asc, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { chatMessages, chatSessions, toolCallLog } from '../db/schema.js';
import {
  AppError,
  MessagePartSchema,
  notFound,
  now,
  partsToText,
  textToParts,
  type MessagePart,
} from '../types/index.types.js';
import { z } from 'zod';

export type ChatSession = typeof chatSessions.$inferSelect;
type ChatMessageRow = typeof chatMessages.$inferSelect;
/** Like the raw row, but `parts` is always populated — the legacy `content`
 *  column is retained for one release as a read-only fallback (see Bucket 2a). */
export type ChatMessage = ChatMessageRow & { parts: MessagePart[] };

const PartsArraySchema = z.array(MessagePartSchema).min(1);

function normalizeRow(row: ChatMessageRow): ChatMessage {
  if (Array.isArray(row.parts) && row.parts.length > 0) {
    return { ...row, parts: row.parts as MessagePart[] };
  }
  return { ...row, parts: textToParts(row.content) };
}

export interface CreateSessionInput {
  agentId: string;
  contextType?: string | null;
  contextId?: string | null;
  title?: string | null;
}

export interface FindOrCreateSessionInput {
  agentId: string;
  contextType: string | null;
  contextId: string | null;
}

/**
 * Append-message payload. Callers may supply `parts` (preferred), `content`
 * (legacy plain text), or both. The service normalizes:
 *   - `parts` only: `content` derived via `partsToText(parts)`.
 *   - `content` only: `parts = [{ kind: 'text', text: content }]`.
 *   - both: caller is trusted; both are persisted as-given.
 * Exactly one of the two must be present.
 */
export interface AppendMessageInput {
  sessionId: string;
  invocationId?: string | null;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  parts?: MessagePart[];
}

export interface ListMessagesOpts {
  limit?: number;
  before?: string;
}

export interface ListSessionsOpts {
  agentId?: string;
  contextType?: string;
  contextId?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSession(input: CreateSessionInput): Promise<ChatSession> {
  const timestamp = now();
  const row: ChatSession = {
    id: nanoid(),
    agentId: input.agentId,
    contextType: input.contextType ?? null,
    contextId: input.contextId ?? null,
    title: input.title ?? null,
    createdAt: timestamp,
    lastMessageAt: timestamp,
  };
  await db.insert(chatSessions).values(row);
  return row;
}

/**
 * Find the most recent session matching the (agentId, contextType, contextId)
 * tuple or create a new one. Null contextType/contextId match null cells in the
 * DB. One active session per combo — callers can force a new session by not
 * going through this helper.
 */
export async function findOrCreateSession(
  input: FindOrCreateSessionInput,
): Promise<ChatSession> {
  const conditions: SQL[] = [eq(chatSessions.agentId, input.agentId)];
  conditions.push(
    input.contextType === null
      ? sql`${chatSessions.contextType} IS NULL`
      : eq(chatSessions.contextType, input.contextType),
  );
  conditions.push(
    input.contextId === null
      ? sql`${chatSessions.contextId} IS NULL`
      : eq(chatSessions.contextId, input.contextId),
  );

  const [existing] = await db
    .select()
    .from(chatSessions)
    .where(and(...conditions))
    .orderBy(desc(chatSessions.lastMessageAt))
    .limit(1);

  if (existing) return existing;

  return createSession({
    agentId: input.agentId,
    contextType: input.contextType,
    contextId: input.contextId,
  });
}

export async function getSession(id: string): Promise<ChatSession> {
  const [row] = await db.select().from(chatSessions).where(eq(chatSessions.id, id));
  if (!row) throw notFound('ChatSession', id);
  return row;
}

/**
 * Pin a context onto a session — but only if the session does not already have
 * one. Per the MCP_TOOLKIT_PLAN Bucket 1 semantics, this never overwrites an
 * existing anchor; callers learn whether the pin took via the returned `pinned`
 * flag.
 */
export async function pinSessionContext(
  id: string,
  contextType: string,
  contextId: string | null,
): Promise<{ pinned: boolean; reason?: string; session: ChatSession }> {
  const session = await getSession(id);
  if (session.contextType) {
    return { pinned: false, reason: 'already_anchored', session };
  }
  const [updated] = await db
    .update(chatSessions)
    .set({ contextType, contextId: contextId ?? null })
    .where(eq(chatSessions.id, id))
    .returning();
  return { pinned: true, session: updated };
}

export async function listSessions(opts: ListSessionsOpts): Promise<ChatSession[]> {
  const conditions: SQL[] = [];
  if (opts.agentId) conditions.push(eq(chatSessions.agentId, opts.agentId));
  if (opts.contextType) conditions.push(eq(chatSessions.contextType, opts.contextType));
  if (opts.contextId) conditions.push(eq(chatSessions.contextId, opts.contextId));

  const limit = opts.limit ?? 50;

  return db
    .select()
    .from(chatSessions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(chatSessions.lastMessageAt))
    .limit(limit);
}

export async function deleteSession(id: string): Promise<void> {
  const [existing] = await db.select().from(chatSessions).where(eq(chatSessions.id, id));
  if (!existing) throw notFound('ChatSession', id);

  db.transaction(tx => {
    // tool_call_log cascades via chat_messages; chat_messages cascades via chat_sessions.
    // Explicit deletes kept for clarity and because tool_call_log.invocationId has
    // no FK constraint we can rely on.
    const messageIds = tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .all()
      .map(r => r.id);

    if (messageIds.length > 0) {
      for (const mid of messageIds) {
        tx.delete(toolCallLog).where(eq(toolCallLog.messageId, mid)).run();
      }
    }

    tx.delete(chatMessages).where(eq(chatMessages.sessionId, id)).run();
    tx.delete(chatSessions).where(eq(chatSessions.id, id)).run();
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, input.sessionId));
  if (!session) throw notFound('ChatSession', input.sessionId);

  if (input.parts === undefined && input.content === undefined) {
    throw new AppError(400, 'appendMessage requires `parts` or `content`.');
  }
  const parts: MessagePart[] = input.parts
    ? PartsArraySchema.parse(input.parts)
    : textToParts(input.content!);
  const content = input.content ?? partsToText(parts);

  const [{ maxOrder }] = await db
    .select({ maxOrder: sql<number | null>`MAX(${chatMessages.sortOrder})` })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, input.sessionId));

  const nextOrder = (maxOrder ?? -1) + 1;
  const timestamp = now();

  const row: ChatMessage = {
    id: nanoid(),
    sessionId: input.sessionId,
    invocationId: input.invocationId ?? null,
    role: input.role,
    content,
    parts,
    sortOrder: nextOrder,
    createdAt: timestamp,
  };

  db.transaction(tx => {
    tx.insert(chatMessages).values(row).run();
    // Derive a title from the first user message if the session has none.
    const shouldSetTitle =
      !session.title && input.role === 'user' && nextOrder === 0;
    const updates: Partial<ChatSession> = { lastMessageAt: timestamp };
    if (shouldSetTitle) {
      updates.title = content.slice(0, 80);
    }
    tx.update(chatSessions).set(updates).where(eq(chatSessions.id, input.sessionId)).run();
  });

  return row;
}

export async function listMessages(
  sessionId: string,
  opts: ListMessagesOpts = {},
): Promise<ChatMessage[]> {
  const conditions: SQL[] = [eq(chatMessages.sessionId, sessionId)];
  if (opts.before) {
    const [anchor] = await db
      .select({ sortOrder: chatMessages.sortOrder })
      .from(chatMessages)
      .where(eq(chatMessages.id, opts.before));
    if (!anchor) throw new AppError(400, `before message not found: ${opts.before}`);
    conditions.push(lt(chatMessages.sortOrder, anchor.sortOrder));
  }

  const limit = opts.limit ?? 100;

  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(...conditions))
    .orderBy(asc(chatMessages.sortOrder))
    .limit(limit);
  return rows.map(normalizeRow);
}

export async function getMessageCount(sessionId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId));
  return count;
}
