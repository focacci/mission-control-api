import { eq, asc, desc, inArray, and, gt, isNull } from 'drizzle-orm';
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
  nowLocalDatetime,
  notFound,
  AppError,
  type CreateAgentAssignmentInput,
  type UpdateAgentAssignmentInput,
  type AgentAssignmentStatus,
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

/**
 * List every agent assignment across all parents, newest first by `updatedAt`.
 * Each row is enriched with its scheduled slots, matching the shape returned
 * by the per-parent list endpoints.
 */
export async function listAllAgentAssignments() {
  const rows = await db
    .select()
    .from(agentAssignments)
    .orderBy(desc(agentAssignments.updatedAt));

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
    description: input.description ?? null,
    agentId: input.agentId ?? null,
    status: 'pending' as AgentAssignmentStatus,
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
  if (input.description !== undefined) updates.description = input.description ?? null;
  if (input.agentId !== undefined) updates.agentId = input.agentId;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  await db.update(agentAssignments).set(updates).where(eq(agentAssignments.id, id));
  return loadAgentAssignment(id);
}

// ---------------------------------------------------------------------------
// Status transitions
//   pending     → scheduled    (start: also assigns the next available slot)
//   scheduled   → in-progress  (start: begin work on the assignment)
//   blocked     → in-progress  (start: resume work)
//   in-progress → done         (complete)
//   in-progress ⇄ blocked      (block / unblock)
// `unassign` is an action, not a transition — it clears slot links and forces
// status back to pending regardless of current state.
// ---------------------------------------------------------------------------

async function setStatus(
  id: string,
  next: AgentAssignmentStatus,
  allowedFrom: AgentAssignmentStatus[],
) {
  const [existing] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!existing) throw notFound('AgentAssignment', id);

  if (existing.status === next) return loadAgentAssignment(id);

  if (!allowedFrom.includes(existing.status as AgentAssignmentStatus)) {
    throw new AppError(
      409,
      `Cannot transition AgentAssignment from '${existing.status}' to '${next}'`,
    );
  }

  const ts = now();
  await db
    .update(agentAssignments)
    .set({
      status: next,
      completedAt: next === 'done' ? ts : null,
      updatedAt: ts,
    })
    .where(eq(agentAssignments.id, id));

  return loadAgentAssignment(id);
}

/**
 * Find the next chronologically-available slot for an assignment.
 *
 * Returns the earliest pending, unassigned slot of type `flex` or
 * `agent_assignment` whose `datetime` is strictly after now (wall clock in
 * `APP_TZ`). Goal allocation on the slot is ignored — "next available" wins
 * over goal alignment, since users expect literal next-slot scheduling.
 */
async function findNextAvailableSlot(_aaId: string) {
  const nowLocal = nowLocalDatetime();
  const [openSlot] = await db
    .select()
    .from(scheduleSlots)
    .where(
      and(
        eq(scheduleSlots.status, 'pending'),
        isNull(scheduleSlots.agentAssignmentId),
        gt(scheduleSlots.datetime, nowLocal),
        inArray(scheduleSlots.type, ['flex', 'agent_assignment']),
      ),
    )
    .orderBy(asc(scheduleSlots.datetime))
    .limit(1);
  return openSlot ?? null;
}

/**
 * Start an assignment.
 *
 *   pending     → scheduled    (auto-assigns the next available slot)
 *   scheduled   → in-progress
 *   blocked     → in-progress
 */
export async function startAgentAssignment(id: string) {
  const [existing] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!existing) throw notFound('AgentAssignment', id);

  if (existing.status === 'pending') {
    const slot = await findNextAvailableSlot(id);
    if (!slot) {
      throw new AppError(
        409,
        'No available time slot to schedule this assignment. Generate or free up a slot first.',
      );
    }

    const ts = now();
    db.transaction(tx => {
      tx.update(scheduleSlots)
        .set({
          agentAssignmentId: id,
          type: 'agent_assignment',
          status: 'pending',
        })
        .where(eq(scheduleSlots.id, slot.id))
        .run();
      tx.update(agentAssignments)
        .set({ status: 'scheduled', updatedAt: ts })
        .where(eq(agentAssignments.id, id))
        .run();
    });
    return loadAgentAssignment(id);
  }

  return setStatus(id, 'in-progress', ['scheduled', 'blocked']);
}

export const completeAgentAssignment = (id: string) =>
  setStatus(id, 'done', ['in-progress']);

/**
 * Bypass the slot-allocation path of `startAgentAssignment` and force an AA
 * to `in-progress` from any non-`done` status. Used by the slot runner, which
 * already knows which slot is firing the AA. No-op if already `in-progress`.
 */
export async function forceInProgress(id: string) {
  const [existing] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!existing) throw notFound('AgentAssignment', id);

  if (existing.status === 'in-progress') return loadAgentAssignment(id);
  if (existing.status === 'done') {
    throw new AppError(409, `Cannot force in-progress: AgentAssignment ${id} is done`);
  }

  await db
    .update(agentAssignments)
    .set({ status: 'in-progress', updatedAt: now() })
    .where(eq(agentAssignments.id, id));

  return loadAgentAssignment(id);
}

export const blockAgentAssignment = (id: string) =>
  setStatus(id, 'blocked', ['in-progress']);

export const reopenAgentAssignment = (id: string) =>
  setStatus(id, 'pending', ['done', 'blocked']);

/**
 * Unassign — clears any scheduled slot links and resets status to `pending`.
 * Works from any state. The AA itself is preserved; only the schedule
 * association is removed.
 */
export async function unassignAgentAssignment(id: string) {
  const [existing] = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.id, id));
  if (!existing) throw notFound('AgentAssignment', id);

  const ts = now();
  db.transaction(tx => {
    tx.update(scheduleSlots)
      .set({ agentAssignmentId: null })
      .where(eq(scheduleSlots.agentAssignmentId, id))
      .run();
    tx.update(agentAssignments)
      .set({ status: 'pending', completedAt: null, updatedAt: ts })
      .where(eq(agentAssignments.id, id))
      .run();
  });

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
