import { eq, asc, inArray, or, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import {
  goals,
  initiatives,
  tasks,
  agentAssignments,
  scheduleSlots,
} from '../db/schema.js';
import {
  now,
  today,
  notFound,
  AppError,
  type CreateAgentAssignmentInput,
  type UpdateAgentAssignmentInput,
} from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Agent Assignments — polymorphic parent: goal | initiative | task
// ---------------------------------------------------------------------------

export type AAParentKind = 'goal' | 'initiative' | 'task';

async function assertParentExists(kind: AAParentKind, parentId: string) {
  if (kind === 'goal') {
    const [g] = await db.select().from(goals).where(eq(goals.id, parentId));
    if (!g) throw notFound('Goal', parentId);
  } else if (kind === 'initiative') {
    const [i] = await db.select().from(initiatives).where(eq(initiatives.id, parentId));
    if (!i) throw notFound('Initiative', parentId);
  } else {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, parentId));
    if (!t) throw notFound('Task', parentId);
  }
}

function parentColumn(kind: AAParentKind) {
  switch (kind) {
    case 'goal':
      return agentAssignments.goalId;
    case 'initiative':
      return agentAssignments.initiativeId;
    case 'task':
      return agentAssignments.taskId;
  }
}

async function loadAgentAssignment(id: string) {
  const [aa] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!aa) throw notFound('AgentAssignment', id);

  const slots = await db
    .select({
      id: scheduleSlots.id,
      date: scheduleSlots.date,
      time: scheduleSlots.time,
      datetime: scheduleSlots.datetime,
      dayOfWeek: scheduleSlots.dayOfWeek,
    })
    .from(scheduleSlots)
    .where(eq(scheduleSlots.agentAssignmentId, id))
    .orderBy(asc(scheduleSlots.datetime));

  return { ...aa, slots };
}

export async function listAgentAssignmentsForParent(
  kind: AAParentKind,
  parentId: string,
) {
  await assertParentExists(kind, parentId);

  const rows = await db
    .select()
    .from(agentAssignments)
    .where(eq(parentColumn(kind), parentId))
    .orderBy(asc(agentAssignments.sortOrder));

  if (rows.length === 0) return [];

  const ids = rows.map(r => r.id);
  const allSlots = await db
    .select({
      id: scheduleSlots.id,
      date: scheduleSlots.date,
      time: scheduleSlots.time,
      datetime: scheduleSlots.datetime,
      dayOfWeek: scheduleSlots.dayOfWeek,
      agentAssignmentId: scheduleSlots.agentAssignmentId,
    })
    .from(scheduleSlots)
    .where(inArray(scheduleSlots.agentAssignmentId, ids))
    .orderBy(asc(scheduleSlots.datetime));

  const slotsByAA = new Map<string, Array<Omit<(typeof allSlots)[number], 'agentAssignmentId'>>>();
  for (const s of allSlots) {
    if (!s.agentAssignmentId) continue;
    const arr = slotsByAA.get(s.agentAssignmentId) ?? [];
    arr.push({
      id: s.id,
      date: s.date,
      time: s.time,
      datetime: s.datetime,
      dayOfWeek: s.dayOfWeek,
    });
    slotsByAA.set(s.agentAssignmentId, arr);
  }

  return rows.map(r => ({ ...r, slots: slotsByAA.get(r.id) ?? [] }));
}

export const listAgentAssignmentsForTask = (taskId: string) =>
  listAgentAssignmentsForParent('task', taskId);
export const listAgentAssignmentsForGoal = (goalId: string) =>
  listAgentAssignmentsForParent('goal', goalId);
export const listAgentAssignmentsForInitiative = (initiativeId: string) =>
  listAgentAssignmentsForParent('initiative', initiativeId);

export async function getAgentAssignment(id: string) {
  return loadAgentAssignment(id);
}

export async function createAgentAssignmentForParent(
  kind: AAParentKind,
  parentId: string,
  input: CreateAgentAssignmentInput,
) {
  await assertParentExists(kind, parentId);

  const existing = await db
    .select()
    .from(agentAssignments)
    .where(eq(parentColumn(kind), parentId));

  const aa = {
    id: nanoid(),
    goalId: kind === 'goal' ? parentId : null,
    initiativeId: kind === 'initiative' ? parentId : null,
    taskId: kind === 'task' ? parentId : null,
    title: input.title,
    instructions: input.instructions,
    agentId: input.agentId ?? null,
    completed: false,
    completedAt: null,
    sortOrder: existing.length,
    createdAt: today(),
    updatedAt: now(),
  };

  await db.insert(agentAssignments).values(aa);
  return loadAgentAssignment(aa.id);
}

export const createAgentAssignment = (
  taskId: string,
  input: CreateAgentAssignmentInput,
) => createAgentAssignmentForParent('task', taskId, input);

export async function updateAgentAssignment(
  id: string,
  input: UpdateAgentAssignmentInput,
) {
  const [existing] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!existing) throw notFound('AgentAssignment', id);

  const updates: Partial<typeof existing> = { updatedAt: now() };
  if (input.title !== undefined) updates.title = input.title;
  if (input.instructions !== undefined) updates.instructions = input.instructions;
  if (input.agentId !== undefined) updates.agentId = input.agentId;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  await db.update(agentAssignments).set(updates).where(eq(agentAssignments.id, id));
  return loadAgentAssignment(id);
}

export async function completeAgentAssignment(id: string) {
  const [existing] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!existing) throw notFound('AgentAssignment', id);

  if (existing.completed) return loadAgentAssignment(id);

  const ts = now();
  await db
    .update(agentAssignments)
    .set({ completed: true, completedAt: ts, updatedAt: ts })
    .where(eq(agentAssignments.id, id));

  return loadAgentAssignment(id);
}

export async function deleteAgentAssignment(id: string) {
  const [existing] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!existing) throw notFound('AgentAssignment', id);

  await db.delete(agentAssignments).where(eq(agentAssignments.id, id));
}

// ---------------------------------------------------------------------------
// Internal: resolve the goal that owns each AA, walking through any parent.
// Used by the scheduler.
// ---------------------------------------------------------------------------

export async function resolveGoalIdsForAssignments(
  aaIds: string[],
): Promise<Map<string, string>> {
  if (!aaIds.length) return new Map();

  const aaRows = await db
    .select({
      id: agentAssignments.id,
      goalId: agentAssignments.goalId,
      initiativeId: agentAssignments.initiativeId,
      taskId: agentAssignments.taskId,
    })
    .from(agentAssignments)
    .where(inArray(agentAssignments.id, aaIds));

  const result = new Map<string, string>();

  // Direct goal links — done.
  const needsInitiativeLookup: typeof aaRows = [];
  const needsTaskLookup: typeof aaRows = [];
  for (const a of aaRows) {
    if (a.goalId) {
      result.set(a.id, a.goalId);
    } else if (a.initiativeId) {
      needsInitiativeLookup.push(a);
    } else if (a.taskId) {
      needsTaskLookup.push(a);
    }
  }

  // Initiative-parented AAs → goal via initiative.goalId
  if (needsInitiativeLookup.length) {
    const initIds = Array.from(
      new Set(needsInitiativeLookup.map(a => a.initiativeId!).filter(Boolean)),
    );
    const initRows = await db
      .select({ id: initiatives.id, goalId: initiatives.goalId })
      .from(initiatives)
      .where(inArray(initiatives.id, initIds));
    const initGoal = new Map(initRows.map(i => [i.id, i.goalId]));
    for (const a of needsInitiativeLookup) {
      const gid = initGoal.get(a.initiativeId!);
      if (gid) result.set(a.id, gid);
    }
  }

  // Task-parented AAs → goal via task.initiativeId → initiative.goalId
  if (needsTaskLookup.length) {
    const taskIds = Array.from(
      new Set(needsTaskLookup.map(a => a.taskId!).filter(Boolean)),
    );
    const taskRows = await db
      .select({ id: tasks.id, initiativeId: tasks.initiativeId })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    const initIds = Array.from(
      new Set(
        taskRows.map(t => t.initiativeId).filter((id): id is string => id != null),
      ),
    );
    const initRows = initIds.length
      ? await db
          .select({ id: initiatives.id, goalId: initiatives.goalId })
          .from(initiatives)
          .where(inArray(initiatives.id, initIds))
      : [];
    const initGoal = new Map(initRows.map(i => [i.id, i.goalId]));
    const taskGoal = new Map<string, string>();
    for (const t of taskRows) {
      if (!t.initiativeId) continue;
      const gid = initGoal.get(t.initiativeId);
      if (gid) taskGoal.set(t.id, gid);
    }
    for (const a of needsTaskLookup) {
      const gid = taskGoal.get(a.taskId!);
      if (gid) result.set(a.id, gid);
    }
  }

  return result;
}

// Re-export for tests / callers that want raw or/and helpers
export { or, and };
