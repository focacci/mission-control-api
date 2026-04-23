import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { briefs } from '../db/schema.js';
import {
  AppError,
  now,
  notFound,
  type ListBriefsQuery,
  type GenerateBriefInput,
  type UpdateBriefInput,
} from '../types/index.types.js';

const KIND_ORDER_EXPR = sql<number>`CASE
  WHEN ${briefs.kind} = 'morning' THEN 0
  WHEN ${briefs.kind} = 'afternoon' THEN 1
  WHEN ${briefs.kind} = 'evening' THEN 2
  ELSE 3
END`;

export async function listBriefs(opts: ListBriefsQuery) {
  if (opts.from > opts.to) {
    throw new AppError(400, `from (${opts.from}) must be <= to (${opts.to})`);
  }
  return db
    .select()
    .from(briefs)
    .where(and(gte(briefs.date, opts.from), lte(briefs.date, opts.to)))
    .orderBy(desc(briefs.date), asc(KIND_ORDER_EXPR));
}

export async function getBrief(id: string) {
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) throw notFound('Brief', id);
  return brief;
}

export async function getBriefsByDate(date: string) {
  const rows = await db.select().from(briefs).where(eq(briefs.date, date));
  const byKind = { morning: null, afternoon: null, evening: null } as Record<
    'morning' | 'afternoon' | 'evening',
    typeof rows[number] | null
  >;
  for (const row of rows) byKind[row.kind] = row;
  return { date, ...byKind };
}

export async function generateBrief(_input: GenerateBriefInput): Promise<never> {
  throw new AppError(
    501,
    'Brief generation is not implemented until the agent runner (Track C) lands. Use PATCH /api/briefs/:id to author manually.',
  );
}

export async function updateBrief(id: string, input: UpdateBriefInput) {
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!existing) throw notFound('Brief', id);

  const updates: Partial<typeof existing> = { updatedAt: now() };
  if ('title' in input) updates.title = input.title ?? null;
  if ('body' in input) updates.body = input.body ?? null;
  if ('references' in input) updates.references = input.references ?? null;
  if (input.status !== undefined) updates.status = input.status;

  await db.update(briefs).set(updates).where(eq(briefs.id, id));
  const [updated] = await db.select().from(briefs).where(eq(briefs.id, id));
  return updated;
}

export async function deleteBrief(id: string) {
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!existing) throw notFound('Brief', id);
  await db.delete(briefs).where(eq(briefs.id, id));
}

// Used by agent runner (Track C) / manual stubs to insert a brief row before
// generation begins. Returns existing row if one already exists for (date, kind).
export async function upsertStubBrief(date: string, kind: 'morning' | 'afternoon' | 'evening') {
  const [existing] = await db
    .select()
    .from(briefs)
    .where(and(eq(briefs.date, date), eq(briefs.kind, kind)));
  if (existing) return existing;

  const timestamp = now();
  const row = {
    id: nanoid(),
    date,
    kind,
    status: 'pending' as const,
    title: null,
    body: null,
    references: null,
    invocationId: null,
    generatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.insert(briefs).values(row);
  return row;
}
