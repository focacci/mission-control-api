import { eq, isNull, and, asc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { goals, initiatives, tasks } from '../db/schema.js';
import {
  now,
  deriveDisplayName,
  notFound,
  AppError,
  type CreateInitiativeInput,
  type UpdateInitiativeInput,
} from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listInitiatives(opts: {
  goalId?: string;
  status?: string;
  includeDeleted?: boolean;
}) {
  const conditions = [];

  if (!opts.includeDeleted) {
    conditions.push(isNull(initiatives.deletedAt));
  }

  if (opts.goalId) {
    conditions.push(eq(initiatives.goalId, opts.goalId));
  }

  if (opts.status) {
    const validStatus = ['active', 'backlog', 'paused', 'completed'];
    if (!validStatus.includes(opts.status)) {
      throw new AppError(400, `Invalid status value: ${opts.status}`);
    }
    conditions.push(
      eq(initiatives.status, opts.status as 'active' | 'backlog' | 'paused' | 'completed'),
    );
  }

  return db
    .select()
    .from(initiatives)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(initiatives.sortOrder));
}

export async function getInitiative(id: string) {
  const [initiative] = await db
    .select()
    .from(initiatives)
    .where(eq(initiatives.id, id));
  if (!initiative) throw notFound('Initiative', id);

  // Load parent goal
  const goal = initiative.goalId
    ? (await db.select().from(goals).where(eq(goals.id, initiative.goalId)))[0] ?? null
    : null;

  // Load tasks (active only by default)
  const initiativeTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.initiativeId, id), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.sortOrder));

  return { ...initiative, goal, tasks: initiativeTasks };
}

export async function createInitiative(input: CreateInitiativeInput) {
  const displayName = deriveDisplayName(input.emoji, input.name);

  const initiative = {
    id: nanoid(),
    emoji: input.emoji,
    name: input.name,
    displayName,
    goalId: input.goalId ?? null,
    status: input.status ?? 'active',
    mission: input.mission ?? null,
    sortOrder: 0,
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: now(),
    deletedAt: null,
  };

  await db.insert(initiatives).values(initiative);
  return initiative;
}

export async function updateInitiative(id: string, input: UpdateInitiativeInput) {
  const [existing] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  if (!existing) throw notFound('Initiative', id);
  if (existing.deletedAt) throw new AppError(410, `Initiative has been deleted: ${id}`);

  const emoji = input.emoji ?? existing.emoji;
  const name = input.name ?? existing.name;

  const updates: Partial<typeof existing> = {
    emoji,
    name,
    displayName: deriveDisplayName(emoji, name),
    updatedAt: now(),
  };

  if (input.status !== undefined) updates.status = input.status;
  if ('mission' in input) updates.mission = input.mission ?? null;
  if ('goalId' in input) updates.goalId = input.goalId ?? null;
  if ('sortOrder' in input) updates.sortOrder = input.sortOrder;

  await db.update(initiatives).set(updates).where(eq(initiatives.id, id));

  const [updated] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  return updated;
}

export async function completeInitiative(id: string) {
  const [existing] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  if (!existing) throw notFound('Initiative', id);
  if (existing.deletedAt) throw new AppError(410, `Initiative has been deleted: ${id}`);

  const timestamp = now();

  // Cancel all non-terminal tasks under this initiative
  await db
    .update(tasks)
    .set({ status: 'cancelled', updatedAt: timestamp })
    .where(
      and(
        eq(tasks.initiativeId, id),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['pending', 'assigned', 'in-progress', 'blocked']),
      ),
    );

  await db
    .update(initiatives)
    .set({ status: 'completed', updatedAt: timestamp })
    .where(eq(initiatives.id, id));

  const [updated] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  return updated;
}

export async function deleteInitiative(id: string) {
  const [existing] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  if (!existing) throw notFound('Initiative', id);
  if (existing.deletedAt) return; // idempotent

  const deletedAt = now();

  await db.transaction(async tx => {
    // Cascade: soft-delete tasks
    await tx
      .update(tasks)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(and(eq(tasks.initiativeId, id), isNull(tasks.deletedAt)));

    await tx
      .update(initiatives)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(initiatives.id, id));
  });
}
