import { eq, and, asc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { goals, initiatives, tasks, agentAssignments } from '../db/schema.js';
import {
  now,
  today,
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
}) {
  const conditions = [];

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

  // Load tasks
  const initiativeTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.initiativeId, id))
    .orderBy(asc(tasks.sortOrder));

  const aas = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.initiativeId, id))
    .orderBy(asc(agentAssignments.sortOrder));

  return { ...initiative, goal, tasks: initiativeTasks, agentAssignments: aas };
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
    createdAt: today(),
    updatedAt: now(),
  };

  await db.insert(initiatives).values(initiative);
  return initiative;
}

export async function updateInitiative(id: string, input: UpdateInitiativeInput) {
  const [existing] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  if (!existing) throw notFound('Initiative', id);

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

  const timestamp = now();

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

  db.transaction(tx => {
    // Find tasks under this initiative so we can drop their AAs explicitly
    const initiativeTasks = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.initiativeId, id))
      .all();
    const taskIds = initiativeTasks.map(t => t.id);

    if (taskIds.length > 0) {
      tx.delete(agentAssignments)
        .where(inArray(agentAssignments.taskId, taskIds))
        .run();
    }

    // Initiative-direct AAs
    tx.delete(agentAssignments)
      .where(eq(agentAssignments.initiativeId, id))
      .run();

    tx.delete(tasks).where(eq(tasks.initiativeId, id)).run();
    tx.delete(initiatives).where(eq(initiatives.id, id)).run();
  });
}
