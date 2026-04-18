import { eq, and, inArray, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { goals, tasks, weekPlans, scheduleSlots, weekGoalAllocations } from '../db/schema.js';
import {
  now,
  today,
  AppError,
  notFound,
  type UpdateSlotInput,
  type DoneSlotInput,
  type SkipSlotInput,
} from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOURS = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SPRINT_TOTAL = 30;
const STEADY_TOTAL = 12;
const SIMMER_TOTAL = 4;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getSundayOf(dateStr?: string): string {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function addDays(baseDate: string, n: number): string {
  const d = new Date(`${baseDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function slotType(
  dayIndex: number,
  hour: string,
): 'maintenance' | 'planning' | 'brief' | 'flex' {
  if (hour === '00') return 'maintenance';
  if (dayIndex === 0 && hour === '02') return 'planning';
  if (hour === '08' || hour === '12' || hour === '20') return 'brief';
  return 'flex';
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getTodaySlots() {
  const date = today();
  const weekStart = getSundayOf(date);

  const [plan] = await db
    .select()
    .from(weekPlans)
    .where(eq(weekPlans.weekStart, weekStart));

  if (!plan) return [];

  const slots = await db
    .select()
    .from(scheduleSlots)
    .where(and(eq(scheduleSlots.weekPlanId, plan.id), eq(scheduleSlots.date, date)))
    .orderBy(asc(scheduleSlots.datetime));

  return enrichSlotsWithTasks(slots);
}

export async function getWeekSlots(weekStart: string) {
  const normalizedStart = getSundayOf(weekStart);

  const [plan] = await db
    .select()
    .from(weekPlans)
    .where(eq(weekPlans.weekStart, normalizedStart));

  if (!plan) throw new AppError(404, `No week plan for week starting ${normalizedStart}`);

  const slots = await db
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.weekPlanId, plan.id))
    .orderBy(asc(scheduleSlots.datetime));

  const allocations = await db
    .select()
    .from(weekGoalAllocations)
    .where(eq(weekGoalAllocations.weekPlanId, plan.id));

  const enrichedSlots = await enrichSlotsWithTasks(slots);

  return { weekPlan: plan, slots: enrichedSlots, allocations };
}

async function enrichSlotsWithTasks(
  slots: (typeof scheduleSlots.$inferSelect)[],
) {
  const taskIds = slots.map(s => s.taskId).filter((id): id is string => id != null);
  if (!taskIds.length) return slots.map(s => ({ ...s, task: null }));

  const taskRows = await db.select().from(tasks).where(inArray(tasks.id, taskIds));
  const taskMap = new Map(taskRows.map(t => [t.id, t]));

  return slots.map(s => ({ ...s, task: s.taskId ? (taskMap.get(s.taskId) ?? null) : null }));
}

// ---------------------------------------------------------------------------
// Week plan generation
// ---------------------------------------------------------------------------

export async function generateWeekPlan(weekStart?: string) {
  const normalizedStart = getSundayOf(weekStart);
  const normalizedEnd = addDays(normalizedStart, 6);

  const [existing] = await db
    .select()
    .from(weekPlans)
    .where(eq(weekPlans.weekStart, normalizedStart));

  if (existing) {
    throw new AppError(409, `Week plan already exists for ${normalizedStart}`);
  }

  const activeGoals = await db
    .select()
    .from(goals)
    .where(inArray(goals.focus, ['sprint', 'steady', 'simmer']));

  const allocations = computeAllocations(activeGoals);

  const totalAllocated = allocations.reduce((sum, a) => sum + a.targetSlots, 0);
  const sprintGoals = activeGoals.filter(g => g.focus === 'sprint');
  const steadyGoals = activeGoals.filter(g => g.focus === 'steady');
  const simmerGoals = activeGoals.filter(g => g.focus === 'simmer');

  const planId = nanoid();
  const plan = {
    id: planId,
    weekStart: normalizedStart,
    weekEnd: normalizedEnd,
    generatedAt: now(),
    sprintSlots: sprintGoals.length
      ? allocations.filter(a => sprintGoals.some(g => g.id === a.goalId)).reduce((s, a) => s + a.targetSlots, 0)
      : 0,
    steadySlots: steadyGoals.length
      ? allocations.filter(a => steadyGoals.some(g => g.id === a.goalId)).reduce((s, a) => s + a.targetSlots, 0)
      : 0,
    simmerSlots: simmerGoals.length
      ? allocations.filter(a => simmerGoals.some(g => g.id === a.goalId)).reduce((s, a) => s + a.targetSlots, 0)
      : 0,
    fixedSlots: 8,
    flexSlots: 0, // filled below after slot generation
  };

  // Build all 84 slots
  type SlotRow = typeof scheduleSlots.$inferInsert;
  const slotRows: SlotRow[] = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const date = addDays(normalizedStart, dayIndex);
    const dayName = DAY_NAMES[dayIndex];

    for (const hr of HOURS) {
      const time = `${hr}:00`;
      const type = slotType(dayIndex, hr);
      slotRows.push({
        id: nanoid(),
        weekPlanId: planId,
        date,
        time,
        datetime: `${date}T${time}`,
        type,
        status: 'pending',
        taskId: null,
        goalId: null,
        note: null,
        dayOfWeek: dayName,
      });
    }
  }

  // Distribute task-eligible flex slots to goals
  const flexSlots = slotRows.filter(s => s.type === 'flex');

  let slotCursor = 0;
  for (const alloc of allocations) {
    for (let i = 0; i < alloc.targetSlots && slotCursor < flexSlots.length; i++) {
      const slot = flexSlots[slotCursor++];
      slot.goalId = alloc.goalId;
      slot.type = 'task';
    }
  }

  const remainingFlex = flexSlots.filter(s => s.type === 'flex').length;
  plan.flexSlots = remainingFlex;

  // Assign pending tasks to goal slots
  const goalIds = allocations.map(a => a.goalId);
  if (goalIds.length) {
    const pendingTasks = await db
      .select()
      .from(tasks)
      .where(and(
        inArray(tasks.status, ['pending', 'assigned']),
        // tasks must belong to an initiative under one of these goals — use goalId from slot
        // simpler: we'll just assign by matching slotGoalId to task's goal via initiative
        // for now, pull all pending tasks and let the slot assignment handle it
      ))
      .orderBy(asc(tasks.sortOrder));

    // Map each pending task to its goal via initiative lookup
    const taskGoalMap = await buildTaskGoalMap(pendingTasks.map(t => t.id));

    for (const alloc of allocations) {
      const goalTaskSlots = slotRows
        .filter(s => s.type === 'task' && s.goalId === alloc.goalId)
        .sort((a, b) => a.datetime!.localeCompare(b.datetime!));

      const goalTasks = pendingTasks.filter(t => taskGoalMap.get(t.id) === alloc.goalId);

      for (let i = 0; i < Math.min(goalTasks.length, goalTaskSlots.length); i++) {
        goalTaskSlots[i].taskId = goalTasks[i].id;
      }
    }
  }

  // Persist everything in a transaction
  const allocationRows = allocations.map(a => ({
    id: nanoid(),
    weekPlanId: planId,
    goalId: a.goalId,
    targetSlots: a.targetSlots,
    assignedSlots: slotRows.filter(s => s.goalId === a.goalId && s.taskId != null).length,
  }));

  const assignedTaskIds = slotRows
    .filter(s => s.taskId != null)
    .map(s => s.taskId as string);

  db.transaction(tx => {
    tx.insert(weekPlans).values(plan).run();

    if (slotRows.length) {
      tx.insert(scheduleSlots).values(slotRows).run();
    }

    if (allocationRows.length) {
      tx.insert(weekGoalAllocations).values(allocationRows).run();
    }

    if (assignedTaskIds.length) {
      tx.update(tasks)
        .set({ status: 'assigned', updatedAt: now() })
        .where(inArray(tasks.id, assignedTaskIds))
        .run();
    }
  });

  const [savedPlan] = await db.select().from(weekPlans).where(eq(weekPlans.id, planId));
  const savedSlots = await db.select().from(scheduleSlots).where(eq(scheduleSlots.weekPlanId, planId)).orderBy(asc(scheduleSlots.datetime));
  const savedAllocations = await db.select().from(weekGoalAllocations).where(eq(weekGoalAllocations.weekPlanId, planId));

  return { weekPlan: savedPlan, slots: savedSlots, allocations: savedAllocations };
}

// ---------------------------------------------------------------------------
// Slot mutations
// ---------------------------------------------------------------------------

export async function updateSlot(id: string, input: UpdateSlotInput) {
  const [existing] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  if (!existing) throw notFound('ScheduleSlot', id);

  const updates: Partial<typeof existing> = {};
  if ('status' in input && input.status !== undefined) updates.status = input.status;
  if ('note' in input) updates.note = input.note ?? null;
  if ('taskId' in input) updates.taskId = input.taskId ?? null;

  await db.update(scheduleSlots).set(updates).where(eq(scheduleSlots.id, id));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  return updated;
}

export async function doneSlot(id: string, input: DoneSlotInput) {
  const [existing] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  if (!existing) throw notFound('ScheduleSlot', id);

  await db
    .update(scheduleSlots)
    .set({ status: 'done', note: input.note ?? existing.note })
    .where(eq(scheduleSlots.id, id));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  return updated;
}

export async function skipSlot(id: string, input: SkipSlotInput) {
  const [existing] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  if (!existing) throw notFound('ScheduleSlot', id);

  await db
    .update(scheduleSlots)
    .set({ status: 'skipped', note: input.reason ?? null })
    .where(eq(scheduleSlots.id, id));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  return updated;
}

export async function assignTask(taskId: string, slotId: string) {
  const [slot] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, slotId));
  if (!slot) throw notFound('ScheduleSlot', slotId);

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound('Task', taskId);

  if (['done', 'cancelled'].includes(task.status)) {
    throw new AppError(400, `Cannot assign a ${task.status} task to a slot`);
  }

  db.transaction(tx => {
    tx.update(scheduleSlots)
      .set({ taskId, type: 'task', status: 'pending', goalId: slot.goalId })
      .where(eq(scheduleSlots.id, slotId))
      .run();

    tx.update(tasks)
      .set({ slotId, status: 'assigned', updatedAt: now() })
      .where(eq(tasks.id, taskId))
      .run();
  });

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, slotId));
  return updated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeAllocations(activeGoals: (typeof goals.$inferSelect)[]) {
  const result: { goalId: string; targetSlots: number }[] = [];

  const distribute = (
    bucket: (typeof goals.$inferSelect)[],
    total: number,
  ) => {
    if (!bucket.length) return;
    const base = Math.floor(total / bucket.length);
    const remainder = total % bucket.length;
    bucket.forEach((g, i) => {
      result.push({ goalId: g.id, targetSlots: base + (i < remainder ? 1 : 0) });
    });
  };

  distribute(activeGoals.filter(g => g.focus === 'sprint'), SPRINT_TOTAL);
  distribute(activeGoals.filter(g => g.focus === 'steady'), STEADY_TOTAL);
  distribute(activeGoals.filter(g => g.focus === 'simmer'), SIMMER_TOTAL);

  return result;
}

async function buildTaskGoalMap(taskIds: string[]): Promise<Map<string, string>> {
  if (!taskIds.length) return new Map();

  // tasks → initiatives → goals
  const { initiatives } = await import('../db/schema.js');

  const taskRows = await db
    .select({ id: tasks.id, initiativeId: tasks.initiativeId })
    .from(tasks)
    .where(inArray(tasks.id, taskIds));

  const initiativeIds = taskRows
    .map(t => t.initiativeId)
    .filter((id): id is string => id != null);

  if (!initiativeIds.length) return new Map();

  const initiativeRows = await db
    .select({ id: initiatives.id, goalId: initiatives.goalId })
    .from(initiatives)
    .where(inArray(initiatives.id, initiativeIds));

  const initiativeGoalMap = new Map(initiativeRows.map(i => [i.id, i.goalId]));

  const map = new Map<string, string>();
  for (const t of taskRows) {
    if (!t.initiativeId) continue;
    const goalId = initiativeGoalMap.get(t.initiativeId);
    if (goalId) map.set(t.id, goalId);
  }

  return map;
}
