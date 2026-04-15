import { eq, isNull, and, sql, asc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { goals, initiatives, tasks } from '../db/schema.js';
import {
  FOCUS_ICONS,
  FOCUS_ORDER,
  now,
  deriveDisplayName,
  notFound,
  AppError,
  type CreateGoalInput,
  type UpdateGoalInput,
} from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort expression: sprint=0, steady=1, simmer=2, dormant=3
 * Used in all goal list queries.
 */
const focusOrderExpr = sql<number>`CASE
  WHEN ${goals.focus} = 'sprint' THEN 0
  WHEN ${goals.focus} = 'steady' THEN 1
  WHEN ${goals.focus} = 'simmer' THEN 2
  WHEN ${goals.focus} = 'dormant' THEN 3
  ELSE 4
END`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listGoals(opts: {
  focus?: string;
  includeDeleted?: boolean;
}) {
  const conditions = [];

  if (!opts.includeDeleted) {
    conditions.push(isNull(goals.deletedAt));
  }

  if (opts.focus) {
    const validFocus = ['sprint', 'steady', 'simmer', 'dormant'];
    if (!validFocus.includes(opts.focus)) {
      throw new AppError(400, `Invalid focus value: ${opts.focus}`);
    }
    conditions.push(eq(goals.focus, opts.focus as 'sprint' | 'steady' | 'simmer' | 'dormant'));
  }

  return db
    .select()
    .from(goals)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(focusOrderExpr, asc(goals.sortOrder));
}

export async function getGoal(id: string) {
  const [goal] = await db.select().from(goals).where(eq(goals.id, id));
  if (!goal) throw notFound('Goal', id);

  const goalInitiatives = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.goalId, id), isNull(initiatives.deletedAt)))
    .orderBy(asc(initiatives.sortOrder));

  return { ...goal, initiatives: goalInitiatives };
}

export async function createGoal(input: CreateGoalInput) {
  const focus = input.focus ?? 'steady';
  const focusIcon = FOCUS_ICONS[focus];
  const displayName = deriveDisplayName(input.emoji, input.name);

  const goal = {
    id: nanoid(),
    emoji: input.emoji,
    name: input.name,
    displayName,
    focus,
    focusIcon,
    timeline: input.timeline ?? null,
    story: input.story ?? null,
    sortOrder: 0,
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: now(),
    deletedAt: null,
  };

  await db.insert(goals).values(goal);
  return goal;
}

export async function updateGoal(id: string, input: UpdateGoalInput) {
  const [existing] = await db.select().from(goals).where(eq(goals.id, id));
  if (!existing) throw notFound('Goal', id);
  if (existing.deletedAt) throw new AppError(410, `Goal has been deleted: ${id}`);

  const emoji = input.emoji ?? existing.emoji;
  const name = input.name ?? existing.name;
  const focus = input.focus ?? existing.focus;

  const updates: Partial<typeof existing> = {
    emoji,
    name,
    displayName: deriveDisplayName(emoji, name),
    focus,
    focusIcon: FOCUS_ICONS[focus],
    updatedAt: now(),
  };

  // Allow explicit null to clear optional fields
  if ('timeline' in input) updates.timeline = input.timeline ?? null;
  if ('story' in input) updates.story = input.story ?? null;
  if ('sortOrder' in input) updates.sortOrder = input.sortOrder;

  await db.update(goals).set(updates).where(eq(goals.id, id));

  const [updated] = await db.select().from(goals).where(eq(goals.id, id));
  return updated;
}

export async function deleteGoal(id: string) {
  const [existing] = await db.select().from(goals).where(eq(goals.id, id));
  if (!existing) throw notFound('Goal', id);
  if (existing.deletedAt) return; // already deleted — idempotent

  const deletedAt = now();

  await db.transaction(async tx => {
    // Find all active initiatives under this goal
    const goalInitiatives = await tx
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(and(eq(initiatives.goalId, id), isNull(initiatives.deletedAt)));

    const initiativeIds = goalInitiatives.map(i => i.id);

    // Cascade: soft-delete tasks under those initiatives
    if (initiativeIds.length > 0) {
      await tx
        .update(tasks)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            inArray(tasks.initiativeId, initiativeIds),
            isNull(tasks.deletedAt),
          ),
        );

      // Soft-delete initiatives
      await tx
        .update(initiatives)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(inArray(initiatives.id, initiativeIds));
    }

    // Soft-delete the goal
    await tx.update(goals).set({ deletedAt, updatedAt: deletedAt }).where(eq(goals.id, id));
  });
}
