import { eq, and, asc, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { initiatives, tasks, taskRequirements, taskTests, taskOutputs, scheduleSlots } from '../db/schema.js';
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

  const [requirements, tests, outputs] = await Promise.all([
    db
      .select()
      .from(taskRequirements)
      .where(eq(taskRequirements.taskId, id))
      .orderBy(asc(taskRequirements.sortOrder)),
    db
      .select()
      .from(taskTests)
      .where(eq(taskTests.taskId, id))
      .orderBy(asc(taskTests.sortOrder)),
    db
      .select()
      .from(taskOutputs)
      .where(eq(taskOutputs.taskId, id)),
  ]);

  const initiative = task.initiativeId
    ? (await db.select().from(initiatives).where(eq(initiatives.id, task.initiativeId)))[0] ?? null
    : null;

  const slot = task.slotId
    ? (await db
        .select({
          id: scheduleSlots.id,
          date: scheduleSlots.date,
          time: scheduleSlots.time,
          datetime: scheduleSlots.datetime,
          type: scheduleSlots.type,
        })
        .from(scheduleSlots)
        .where(eq(scheduleSlots.id, task.slotId)))[0] ?? null
    : null;

  return { ...task, requirements, tests, outputs, initiative, slot };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function listTasks(opts: {
  initiativeId?: string;
  status?: string | string[];
}) {
  const conditions = [];

  if (opts.initiativeId) {
    conditions.push(eq(tasks.initiativeId, opts.initiativeId));
  }

  if (opts.status) {
    const validStatus = ['pending', 'assigned', 'in-progress', 'done', 'blocked', 'cancelled'];
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    for (const s of statuses) {
      if (!validStatus.includes(s)) throw new AppError(400, `Invalid status: ${s}`);
    }
    conditions.push(
      inArray(
        tasks.status,
        statuses as ('pending' | 'assigned' | 'in-progress' | 'done' | 'blocked' | 'cancelled')[],
      ),
    );
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(tasks.sortOrder));

  // Load requirements and tests in bulk
  if (rows.length === 0) return [];

  const ids = rows.map(r => r.id);
  const [reqs, tsts] = await Promise.all([
    db
      .select()
      .from(taskRequirements)
      .where(inArray(taskRequirements.taskId, ids))
      .orderBy(asc(taskRequirements.sortOrder)),
    db
      .select()
      .from(taskTests)
      .where(inArray(taskTests.taskId, ids))
      .orderBy(asc(taskTests.sortOrder)),
  ]);

  const reqsByTask = reqs.reduce(
    (acc, r) => {
      (acc[r.taskId] ??= []).push(r);
      return acc;
    },
    {} as Record<string, typeof reqs>,
  );
  const testsByTask = tsts.reduce(
    (acc, t) => {
      (acc[t.taskId] ??= []).push(t);
      return acc;
    },
    {} as Record<string, typeof tsts>,
  );

  return rows.map(t => ({
    ...t,
    requirements: reqsByTask[t.id] ?? [],
    tests: testsByTask[t.id] ?? [],
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
    slotId: null,
    sortOrder: 0,
    createdAt,
    updatedAt,
    completedAt: null,
  };

  db.transaction(tx => {
    tx.insert(tasks).values(task).run();

    // Insert requirements
    if (input.requirements && input.requirements.length > 0) {
      tx.insert(taskRequirements).values(
        input.requirements.map((desc, i) => ({
          id: nanoid(),
          taskId: task.id,
          description: desc,
          completed: false,
          sortOrder: i,
        })),
      ).run();
    }

    // Insert tests
    if (input.tests && input.tests.length > 0) {
      tx.insert(taskTests).values(
        input.tests.map((desc, i) => ({
          id: nanoid(),
          taskId: task.id,
          description: desc,
          passed: false,
          sortOrder: i,
        })),
      ).run();
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

  // Validate: all requirements must be completed
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

  db.transaction(tx => {
    tx.update(tasks)
      .set({ status: 'done', summary: input.summary, completedAt, updatedAt: completedAt })
      .where(eq(tasks.id, id))
      .run();

    // Insert outputs
    if (input.outputs && input.outputs.length > 0) {
      tx.insert(taskOutputs).values(
        input.outputs.map(o => ({
          id: nanoid(),
          taskId: id,
          label: o.label,
          url: o.url ?? null,
          createdAt: completedAt,
        })),
      ).run();
    }
  });

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

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export async function addRequirement(taskId: string, description: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound('Task', taskId);

  const existing = await db
    .select()
    .from(taskRequirements)
    .where(eq(taskRequirements.taskId, taskId));

  const req = {
    id: nanoid(),
    taskId,
    description,
    completed: false,
    sortOrder: existing.length,
  };
  await db.insert(taskRequirements).values(req);
  return req;
}

export async function updateRequirement(
  taskId: string,
  reqId: string,
  patch: { description?: string; completed?: boolean },
) {
  const [req] = await db
    .select()
    .from(taskRequirements)
    .where(and(eq(taskRequirements.id, reqId), eq(taskRequirements.taskId, taskId)));
  if (!req) throw notFound('Requirement', reqId);

  const updates: Partial<typeof req> = {};
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.completed !== undefined) updates.completed = patch.completed;

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, 'No requirement updates provided');
  }

  await db.update(taskRequirements).set(updates).where(eq(taskRequirements.id, reqId));

  const [updated] = await db
    .select()
    .from(taskRequirements)
    .where(eq(taskRequirements.id, reqId));
  return updated;
}

export async function checkRequirement(taskId: string, reqId: string, completed: boolean) {
  return updateRequirement(taskId, reqId, { completed });
}

export async function deleteRequirement(taskId: string, reqId: string) {
  const [req] = await db
    .select()
    .from(taskRequirements)
    .where(and(eq(taskRequirements.id, reqId), eq(taskRequirements.taskId, taskId)));
  if (!req) throw notFound('Requirement', reqId);

  await db.delete(taskRequirements).where(eq(taskRequirements.id, reqId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export async function addTest(taskId: string, description: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound('Task', taskId);

  const existing = await db
    .select()
    .from(taskTests)
    .where(eq(taskTests.taskId, taskId));

  const test = {
    id: nanoid(),
    taskId,
    description,
    passed: false,
    sortOrder: existing.length,
  };
  await db.insert(taskTests).values(test);
  return test;
}

export async function updateTest(
  taskId: string,
  testId: string,
  patch: { description?: string; passed?: boolean },
) {
  const [test] = await db
    .select()
    .from(taskTests)
    .where(and(eq(taskTests.id, testId), eq(taskTests.taskId, taskId)));
  if (!test) throw notFound('Test', testId);

  const updates: Partial<typeof test> = {};
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.passed !== undefined) updates.passed = patch.passed;

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, 'No test updates provided');
  }

  await db.update(taskTests).set(updates).where(eq(taskTests.id, testId));

  const [updated] = await db.select().from(taskTests).where(eq(taskTests.id, testId));
  return updated;
}

export async function deleteTest(taskId: string, testId: string) {
  const [test] = await db
    .select()
    .from(taskTests)
    .where(and(eq(taskTests.id, testId), eq(taskTests.taskId, taskId)));
  if (!test) throw notFound('Test', testId);

  await db.delete(taskTests).where(eq(taskTests.id, testId));
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export async function addOutput(taskId: string, label: string, url?: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw notFound('Task', taskId);

  const output = {
    id: nanoid(),
    taskId,
    label,
    url: url ?? null,
    createdAt: now(),
  };
  await db.insert(taskOutputs).values(output);
  return output;
}

export async function deleteOutput(taskId: string, outputId: string) {
  const [output] = await db
    .select()
    .from(taskOutputs)
    .where(and(eq(taskOutputs.id, outputId), eq(taskOutputs.taskId, taskId)));
  if (!output) throw notFound('Output', outputId);

  await db.delete(taskOutputs).where(eq(taskOutputs.id, outputId));
}
