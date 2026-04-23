import { eq, and, asc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import {
  goals,
  initiatives,
  tasks,
  taskRequirements,
  requirementTests,
  agentAssignments,
} from '../db/schema.js';
import {
  now,
  today,
  notFound,
  AppError,
  type CreateTaskInput,
  type UpdateTaskInput,
  type DoneTaskInput,
  type BlockTaskInput,
} from '../types/index.types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadTaskDetail(id: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) throw notFound('Task', id);

  const [reqs, aas] = await Promise.all([
    db
      .select()
      .from(taskRequirements)
      .where(eq(taskRequirements.taskId, id))
      .orderBy(asc(taskRequirements.sortOrder)),
    db
      .select()
      .from(agentAssignments)
      .where(eq(agentAssignments.taskId, id))
      .orderBy(asc(agentAssignments.sortOrder)),
  ]);

  const reqIds = reqs.map(r => r.id);
  const tests = reqIds.length
    ? await db
        .select()
        .from(requirementTests)
        .where(inArray(requirementTests.requirementId, reqIds))
        .orderBy(asc(requirementTests.sortOrder))
    : [];

  const testsByReq = new Map<string, typeof tests>();
  for (const t of tests) {
    const arr = testsByReq.get(t.requirementId) ?? [];
    arr.push(t);
    testsByReq.set(t.requirementId, arr);
  }

  const requirementsWithTests = reqs.map(r => ({
    ...r,
    tests: testsByReq.get(r.id) ?? [],
  }));

  const initiative = task.initiativeId
    ? (await db.select().from(initiatives).where(eq(initiatives.id, task.initiativeId)))[0] ?? null
    : null;

  const goal = initiative?.goalId
    ? (await db.select().from(goals).where(eq(goals.id, initiative.goalId)))[0] ?? null
    : null;

  return {
    ...task,
    requirements: requirementsWithTests,
    agentAssignments: aas,
    initiative: initiative
      ? { id: initiative.id, emoji: initiative.emoji, name: initiative.name }
      : null,
    goal: goal ? { id: goal.id, emoji: goal.emoji, name: goal.name } : null,
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const VALID_STATUS = ['pending', 'in-progress', 'done', 'blocked', 'cancelled'] as const;
type TaskStatus = (typeof VALID_STATUS)[number];

export async function listTasks(opts: {
  initiativeId?: string;
  status?: string | string[];
}) {
  const conditions = [];

  if (opts.initiativeId) {
    conditions.push(eq(tasks.initiativeId, opts.initiativeId));
  }

  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    for (const s of statuses) {
      if (!VALID_STATUS.includes(s as TaskStatus)) {
        throw new AppError(400, `Invalid status: ${s}`);
      }
    }
    conditions.push(inArray(tasks.status, statuses as TaskStatus[]));
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(tasks.sortOrder));

  if (rows.length === 0) return [];

  const ids = rows.map(r => r.id);
  const [reqs, aas] = await Promise.all([
    db
      .select()
      .from(taskRequirements)
      .where(inArray(taskRequirements.taskId, ids))
      .orderBy(asc(taskRequirements.sortOrder)),
    db
      .select()
      .from(agentAssignments)
      .where(inArray(agentAssignments.taskId, ids))
      .orderBy(asc(agentAssignments.sortOrder)),
  ]);

  const reqIds = reqs.map(r => r.id);
  const tests = reqIds.length
    ? await db
        .select()
        .from(requirementTests)
        .where(inArray(requirementTests.requirementId, reqIds))
        .orderBy(asc(requirementTests.sortOrder))
    : [];

  const testsByReq = new Map<string, typeof tests>();
  for (const t of tests) {
    const arr = testsByReq.get(t.requirementId) ?? [];
    arr.push(t);
    testsByReq.set(t.requirementId, arr);
  }

  const reqsByTask = new Map<string, Array<(typeof reqs)[number] & { tests: typeof tests }>>();
  for (const r of reqs) {
    const arr = reqsByTask.get(r.taskId) ?? [];
    arr.push({ ...r, tests: testsByReq.get(r.id) ?? [] });
    reqsByTask.set(r.taskId, arr);
  }

  const aasByTask = new Map<string, typeof aas>();
  for (const a of aas) {
    const arr = aasByTask.get(a.taskId) ?? [];
    arr.push(a);
    aasByTask.set(a.taskId, arr);
  }

  return rows.map(t => ({
    ...t,
    requirements: reqsByTask.get(t.id) ?? [],
    agentAssignments: aasByTask.get(t.id) ?? [],
  }));
}

export async function getTask(id: string) {
  return loadTaskDetail(id);
}

export async function createTask(input: CreateTaskInput) {
  const createdAt = today();
  const updatedAt = now();

  const task = {
    id: nanoid(),
    name: input.name,
    displayName: input.name,
    initiativeId: input.initiativeId ?? null,
    status: 'pending' as const,
    objective: input.objective,
    summary: null,
    sortOrder: 0,
    createdAt,
    updatedAt,
    completedAt: null,
  };

  db.transaction(tx => {
    tx.insert(tasks).values(task).run();

    if (input.requirements && input.requirements.length > 0) {
      tx.insert(taskRequirements)
        .values(
          input.requirements.map((desc, i) => ({
            id: nanoid(),
            taskId: task.id,
            description: desc,
            completed: false,
            sortOrder: i,
          })),
        )
        .run();
    }
  });

  return loadTaskDetail(task.id);
}

export async function updateTask(id: string, input: UpdateTaskInput) {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) throw notFound('Task', id);

  const name = input.name ?? existing.name;
  const displayName = name;

  const updates: Partial<typeof existing> = {
    name,
    displayName,
    updatedAt: now(),
  };

  if (input.objective !== undefined) updates.objective = input.objective;
  if (input.status !== undefined) updates.status = input.status;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  await db.update(tasks).set(updates).where(eq(tasks.id, id));
  return loadTaskDetail(id);
}

export async function startTask(id: string) {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) throw notFound('Task', id);

  if (existing.status === 'done' || existing.status === 'cancelled') {
    throw new AppError(409, `Cannot start a task with status '${existing.status}'`);
  }

  await db
    .update(tasks)
    .set({ status: 'in-progress', updatedAt: now() })
    .where(eq(tasks.id, id));

  return loadTaskDetail(id);
}

export async function doneTask(id: string, input: DoneTaskInput) {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) throw notFound('Task', id);

  if (existing.status === 'cancelled') {
    throw new AppError(409, `Cannot complete a cancelled task`);
  }

  const reqs = await db
    .select()
    .from(taskRequirements)
    .where(eq(taskRequirements.taskId, id));

  const incomplete = reqs.filter(r => !r.completed);
  if (incomplete.length > 0) {
    throw new AppError(400, 'Cannot complete task: unchecked requirements remain', {
      incomplete: incomplete.map(r => ({ id: r.id, description: r.description })),
    });
  }

  const completedAt = now();

  await db
    .update(tasks)
    .set({ status: 'done', summary: input.summary, completedAt, updatedAt: completedAt })
    .where(eq(tasks.id, id));

  return loadTaskDetail(id);
}

export async function blockTask(id: string, input: BlockTaskInput) {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) throw notFound('Task', id);

  if (existing.status === 'done' || existing.status === 'cancelled') {
    throw new AppError(409, `Cannot block a task with status '${existing.status}'`);
  }

  await db
    .update(tasks)
    .set({ status: 'blocked', summary: input.reason, updatedAt: now() })
    .where(eq(tasks.id, id));

  return loadTaskDetail(id);
}

export async function cancelTask(id: string) {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) throw notFound('Task', id);

  if (existing.status === 'done') {
    throw new AppError(409, `Cannot cancel a completed task`);
  }

  await db
    .update(tasks)
    .set({ status: 'cancelled', updatedAt: now() })
    .where(eq(tasks.id, id));

  return loadTaskDetail(id);
}

export async function deleteTask(id: string) {
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing) throw notFound('Task', id);

  await db.delete(tasks).where(eq(tasks.id, id));
}
