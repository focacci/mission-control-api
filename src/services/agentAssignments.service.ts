import { eq, asc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { tasks, agentAssignments, scheduleSlots } from '../db/schema.js';
import {
  now,
  today,
  notFound,
  type CreateAgentAssignmentInput,
  type UpdateAgentAssignmentInput,
} from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Agent Assignments
// ---------------------------------------------------------------------------

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

export async function listAgentAssignmentsForTask(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound('Task', taskId);

  const rows = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, taskId))
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

export async function getAgentAssignment(id: string) {
  return loadAgentAssignment(id);
}

export async function createAgentAssignment(
  taskId: string,
  input: CreateAgentAssignmentInput,
) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound('Task', taskId);

  const existing = await db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, taskId));

  const aa = {
    id: nanoid(),
    taskId,
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
