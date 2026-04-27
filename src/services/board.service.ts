import { eq, and, sql, asc, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { today } from '../types/index.types.js';
import { goals, initiatives, tasks, weekPlans, scheduleSlots, weekGoalAllocations } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export async function getBoard() {
  const allGoals = await db
    .select()
    .from(goals)
    .orderBy(
      sql<number>`CASE
        WHEN ${goals.focus} = 'sprint' THEN 0
        WHEN ${goals.focus} = 'steady' THEN 1
        WHEN ${goals.focus} = 'simmer' THEN 2
        WHEN ${goals.focus} = 'dormant' THEN 3
        ELSE 4
      END`,
      asc(goals.sortOrder),
    );

  const allInitiatives = await db
    .select()
    .from(initiatives)
    .orderBy(asc(initiatives.sortOrder));

  const allTasks = await db
    .select()
    .from(tasks)
    .orderBy(asc(tasks.sortOrder));

  // Build hierarchy
  const initiativesByGoal = new Map<string, typeof allInitiatives>();
  for (const initiative of allInitiatives) {
    const key = initiative.goalId ?? '__none__';
    if (!initiativesByGoal.has(key)) initiativesByGoal.set(key, []);
    initiativesByGoal.get(key)!.push(initiative);
  }

  const tasksByInitiative = new Map<string, typeof allTasks>();
  for (const task of allTasks) {
    const key = task.initiativeId ?? '__none__';
    if (!tasksByInitiative.has(key)) tasksByInitiative.set(key, []);
    tasksByInitiative.get(key)!.push(task);
  }

  const goalsWithHierarchy = allGoals.map(goal => ({
    ...goal,
    initiatives: (initiativesByGoal.get(goal.id) ?? []).map(init => ({
      ...init,
      tasks: tasksByInitiative.get(init.id) ?? [],
    })),
  }));

  // Stats
  const stats = computeStats(allTasks);

  // Current week summary
  const weekSummary = await getWeekSummary();

  return { goals: goalsWithHierarchy, stats, weekSummary };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeStats(allTasks: (typeof tasks.$inferSelect)[]) {
  return {
    total: allTasks.length,
    pending: allTasks.filter(t => t.status === 'pending').length,
    done: allTasks.filter(t => t.status === 'done').length,
  };
}

async function getWeekSummary() {
  const todayStr = today();
  const day = new Date(`${todayStr}T00:00:00`).getDay();
  const d = new Date(`${todayStr}T00:00:00`);
  d.setDate(d.getDate() - day);
  const weekStart = d.toISOString().slice(0, 10);

  const [plan] = await db
    .select()
    .from(weekPlans)
    .where(eq(weekPlans.weekStart, weekStart));

  if (!plan) return null;

  const slots = await db
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.weekPlanId, plan.id));

  const allocations = await db
    .select()
    .from(weekGoalAllocations)
    .where(eq(weekGoalAllocations.weekPlanId, plan.id));

  const assignmentSlots = slots.filter(s => s.type === 'agent_assignment');

  return {
    weekPlan: plan,
    totalSlots: slots.length,
    assignmentSlots: assignmentSlots.length,
    doneSlots: slots.filter(s => s.status === 'done').length,
    skippedSlots: slots.filter(s => s.status === 'skipped').length,
    pendingSlots: slots.filter(s => s.status === 'pending').length,
    allocations,
  };
}
