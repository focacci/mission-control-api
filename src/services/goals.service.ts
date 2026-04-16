import { eq, and, sql, asc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { goals, initiatives, tasks } from '../db/schema.js';
import {
  FOCUS_ICONS,
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
}) {
  const conditions = [];

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
    .where(eq(initiatives.goalId, id))
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
  };

  await db.insert(goals).values(goal);
  return goal;
}

export async function updateGoal(id: string, input: UpdateGoalInput) {
  const [existing] = await db.select().from(goals).where(eq(goals.id, id));
  if (!existing) throw notFound('Goal', id);

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

  db.transaction(tx => {
    // Find all initiatives under this goal
    const goalInitiatives = tx
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(eq(initiatives.goalId, id))
      .all();

    const initiativeIds = goalInitiatives.map(i => i.id);

    // Cascade: hard-delete tasks under those initiatives
    if (initiativeIds.length > 0) {
      tx.delete(tasks).where(inArray(tasks.initiativeId, initiativeIds)).run();

      // Hard-delete initiatives
      tx.delete(initiatives).where(inArray(initiatives.id, initiativeIds)).run();
    }

    // Hard-delete the goal
    tx.delete(goals).where(eq(goals.id, id)).run();
  });
}
