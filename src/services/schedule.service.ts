import { eq, and, inArray, asc, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import {
  goals,
  agentAssignments,
  weekPlans,
  scheduleSlots,
  slotOutputs,
  weekGoalAllocations,
} from '../db/schema.js';
import {
  now,
  today,
  AppError,
  notFound,
  type UpdateSlotInput,
  type DoneSlotInput,
  type SkipSlotInput,
  type AddSlotOutputInput,
} from '../types/index.types.js';
import { resolveGoalIdsForAssignments } from './agentAssignments.service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLOT_TIMES = [
  '00:00', // Maintenance
  '02:00',
  '04:00',
  '06:00',
  '07:00', // Morning Brief
  '08:00',
  '10:00',
  '12:00',
  '12:30', // Afternoon Brief
  '14:00',
  '16:00',
  '18:00',
  '19:00', // Evening Brief
  '20:00',
  '22:00',
];
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
  time: string,
): 'maintenance' | 'planning' | 'brief' | 'flex' {
  if (time === '00:00') return 'maintenance';
  if (dayIndex === 0 && time === '02:00') return 'planning';
  if (time === '07:00' || time === '12:30' || time === '19:00') return 'brief';
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

  return enrichSlotsWithAssignments(slots);
}

export async function getSlotsInRange(from: string, to: string) {
  if (from > to) {
    throw new AppError(400, '`from` must be on or before `to`');
  }

  const slots = await db
    .select()
    .from(scheduleSlots)
    .where(and(gte(scheduleSlots.date, from), lte(scheduleSlots.date, to)))
    .orderBy(asc(scheduleSlots.datetime));

  const enriched = await enrichSlotsWithAssignments(slots);
  return { from, to, slots: enriched };
}

export async function getWeekSlots(weekStart: string) {
  const normalizedStart = getSundayOf(weekStart);

  const [plan] = await db
    .select()
    .from(weekPlans)
    .where(eq(weekPlans.weekStart, normalizedStart));

  if (!plan) return { weekPlan: null, slots: [], allocations: [] };

  const slots = await db
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.weekPlanId, plan.id))
    .orderBy(asc(scheduleSlots.datetime));

  const allocations = await db
    .select()
    .from(weekGoalAllocations)
    .where(eq(weekGoalAllocations.weekPlanId, plan.id));

  const enriched = await enrichSlotsWithAssignments(slots);

  return { weekPlan: plan, slots: enriched, allocations };
}

async function enrichSlotsWithAssignments(
  slots: (typeof scheduleSlots.$inferSelect)[],
) {
  if (!slots.length) return [];

  const aaIds = slots
    .map(s => s.agentAssignmentId)
    .filter((id): id is string => id != null);

  const aaRows = aaIds.length
    ? await db.select().from(agentAssignments).where(inArray(agentAssignments.id, aaIds))
    : [];
  const aaMap = new Map(aaRows.map(a => [a.id, a]));

  const slotIds = slots.map(s => s.id);
  const outputs = slotIds.length
    ? await db
        .select()
        .from(slotOutputs)
        .where(inArray(slotOutputs.slotId, slotIds))
        .orderBy(asc(slotOutputs.createdAt))
    : [];
  const outputsBySlot = new Map<string, typeof outputs>();
  for (const o of outputs) {
    const arr = outputsBySlot.get(o.slotId) ?? [];
    arr.push(o);
    outputsBySlot.set(o.slotId, arr);
  }

  return slots.map(s => ({
    ...s,
    agentAssignment: s.agentAssignmentId ? aaMap.get(s.agentAssignmentId) ?? null : null,
    outputs: outputsBySlot.get(s.id) ?? [],
  }));
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
      ? allocations
          .filter(a => sprintGoals.some(g => g.id === a.goalId))
          .reduce((s, a) => s + a.targetSlots, 0)
      : 0,
    steadySlots: steadyGoals.length
      ? allocations
          .filter(a => steadyGoals.some(g => g.id === a.goalId))
          .reduce((s, a) => s + a.targetSlots, 0)
      : 0,
    simmerSlots: simmerGoals.length
      ? allocations
          .filter(a => simmerGoals.some(g => g.id === a.goalId))
          .reduce((s, a) => s + a.targetSlots, 0)
      : 0,
    fixedSlots: 29,
    flexSlots: 0,
  };

  type SlotRow = typeof scheduleSlots.$inferInsert;
  const slotRows: SlotRow[] = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const date = addDays(normalizedStart, dayIndex);
    const dayName = DAY_NAMES[dayIndex];

    for (const time of SLOT_TIMES) {
      const type = slotType(dayIndex, time);
      slotRows.push({
        id: nanoid(),
        weekPlanId: planId,
        date,
        time,
        datetime: `${date}T${time}`,
        type,
        status: 'pending',
        agentAssignmentId: null,
        goalId: null,
        note: null,
        dayOfWeek: dayName,
      });
    }
  }

  // Allocate flex slots to goals, converting to agent_assignment type
  const flexSlots = slotRows.filter(s => s.type === 'flex');

  let slotCursor = 0;
  for (const alloc of allocations) {
    for (let i = 0; i < alloc.targetSlots && slotCursor < flexSlots.length; i++) {
      const slot = flexSlots[slotCursor++];
      slot.goalId = alloc.goalId;
      slot.type = 'agent_assignment';
    }
  }

  const remainingFlex = flexSlots.filter(s => s.type === 'flex').length;
  plan.flexSlots = remainingFlex;

  // Auto-assign pending agent assignments to their goal's slots
  const goalIds = allocations.map(a => a.goalId);
  if (goalIds.length) {
    const pendingAAs = await db
      .select()
      .from(agentAssignments)
      .where(inArray(agentAssignments.status, ['pending', 'scheduled', 'in-progress', 'blocked']))
      .orderBy(asc(agentAssignments.sortOrder));

    const aaGoalMap = await resolveGoalIdsForAssignments(pendingAAs.map(a => a.id));

    for (const alloc of allocations) {
      const goalAASlots = slotRows
        .filter(s => s.type === 'agent_assignment' && s.goalId === alloc.goalId)
        .sort((a, b) => a.datetime!.localeCompare(b.datetime!));

      const goalAAs = pendingAAs.filter(a => aaGoalMap.get(a.id) === alloc.goalId);

      for (let i = 0; i < Math.min(goalAAs.length, goalAASlots.length); i++) {
        goalAASlots[i].agentAssignmentId = goalAAs[i].id;
      }
    }
  }

  const allocationRows = allocations.map(a => ({
    id: nanoid(),
    weekPlanId: planId,
    goalId: a.goalId,
    targetSlots: a.targetSlots,
    assignedSlots: slotRows.filter(
      s => s.goalId === a.goalId && s.agentAssignmentId != null,
    ).length,
  }));

  db.transaction(tx => {
    tx.insert(weekPlans).values(plan).run();

    if (slotRows.length) {
      tx.insert(scheduleSlots).values(slotRows).run();
    }

    if (allocationRows.length) {
      tx.insert(weekGoalAllocations).values(allocationRows).run();
    }
  });

  const [savedPlan] = await db.select().from(weekPlans).where(eq(weekPlans.id, planId));
  const savedSlots = await db
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.weekPlanId, planId))
    .orderBy(asc(scheduleSlots.datetime));
  const savedAllocations = await db
    .select()
    .from(weekGoalAllocations)
    .where(eq(weekGoalAllocations.weekPlanId, planId));

  const enriched = await enrichSlotsWithAssignments(savedSlots);

  return { weekPlan: savedPlan, slots: enriched, allocations: savedAllocations };
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
  if ('agentAssignmentId' in input) updates.agentAssignmentId = input.agentAssignmentId ?? null;

  await db.update(scheduleSlots).set(updates).where(eq(scheduleSlots.id, id));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  const [enriched] = await enrichSlotsWithAssignments([updated]);
  return enriched;
}

export async function doneSlot(id: string, input: DoneSlotInput) {
  const [existing] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  if (!existing) throw notFound('ScheduleSlot', id);

  await db
    .update(scheduleSlots)
    .set({ status: 'done', note: input.note ?? existing.note })
    .where(eq(scheduleSlots.id, id));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  const [enriched] = await enrichSlotsWithAssignments([updated]);
  return enriched;
}

export async function skipSlot(id: string, input: SkipSlotInput) {
  const [existing] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  if (!existing) throw notFound('ScheduleSlot', id);

  await db
    .update(scheduleSlots)
    .set({ status: 'skipped', note: input.reason ?? null })
    .where(eq(scheduleSlots.id, id));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, id));
  const [enriched] = await enrichSlotsWithAssignments([updated]);
  return enriched;
}

export async function unassignAgentAssignment(slotId: string) {
  const [slot] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, slotId));
  if (!slot) throw notFound('ScheduleSlot', slotId);
  if (!slot.agentAssignmentId) {
    throw new AppError(400, 'Slot has no assigned agent assignment');
  }

  await db
    .update(scheduleSlots)
    .set({ agentAssignmentId: null, status: 'pending' })
    .where(eq(scheduleSlots.id, slotId));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, slotId));
  const [enriched] = await enrichSlotsWithAssignments([updated]);
  return enriched;
}

export async function assignAgentAssignment(agentAssignmentId: string, slotId: string) {
  const [slot] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, slotId));
  if (!slot) throw notFound('ScheduleSlot', slotId);

  const [aa] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, agentAssignmentId));
  if (!aa) throw notFound('AgentAssignment', agentAssignmentId);

  if (aa.status === 'done') {
    throw new AppError(400, 'Cannot assign a completed agent assignment');
  }

  await db
    .update(scheduleSlots)
    .set({
      agentAssignmentId,
      type: 'agent_assignment',
      status: 'pending',
      goalId: slot.goalId,
    })
    .where(eq(scheduleSlots.id, slotId));

  const [updated] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, slotId));
  const [enriched] = await enrichSlotsWithAssignments([updated]);
  return enriched;
}

// ---------------------------------------------------------------------------
// Slot outputs
// ---------------------------------------------------------------------------

export async function addSlotOutput(slotId: string, input: AddSlotOutputInput) {
  const [slot] = await db.select().from(scheduleSlots).where(eq(scheduleSlots.id, slotId));
  if (!slot) throw notFound('ScheduleSlot', slotId);

  const output = {
    id: nanoid(),
    slotId,
    label: input.label,
    url: input.url ?? null,
    kind: input.kind,
    createdAt: now(),
  };
  await db.insert(slotOutputs).values(output);
  return output;
}

export async function deleteSlotOutput(slotId: string, outputId: string) {
  const [output] = await db
    .select()
    .from(slotOutputs)
    .where(and(eq(slotOutputs.id, outputId), eq(slotOutputs.slotId, slotId)));
  if (!output) throw notFound('SlotOutput', outputId);

  await db.delete(slotOutputs).where(eq(slotOutputs.id, outputId));
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

