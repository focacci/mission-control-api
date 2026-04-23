import { eq, and, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { tasks, taskRequirements, requirementTests } from '../db/schema.js';
import { AppError, notFound } from '../types/index.types.js';

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
  return { ...req, tests: [] as (typeof requirementTests.$inferSelect)[] };
}

export async function updateRequirement(
  reqId: string,
  patch: { description?: string; completed?: boolean },
) {
  const [req] = await db
    .select()
    .from(taskRequirements)
    .where(eq(taskRequirements.id, reqId));
  if (!req) throw notFound('Requirement', reqId);

  const updates: Partial<typeof req> = {};
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.completed !== undefined) updates.completed = patch.completed;

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, 'No requirement updates provided');
  }

  await db.update(taskRequirements).set(updates).where(eq(taskRequirements.id, reqId));

  return loadRequirement(reqId);
}

export async function checkRequirement(reqId: string, completed: boolean) {
  return updateRequirement(reqId, { completed });
}

export async function deleteRequirement(reqId: string) {
  const [req] = await db
    .select()
    .from(taskRequirements)
    .where(eq(taskRequirements.id, reqId));
  if (!req) throw notFound('Requirement', reqId);

  await db.delete(taskRequirements).where(eq(taskRequirements.id, reqId));
}

async function loadRequirement(reqId: string) {
  const [req] = await db
    .select()
    .from(taskRequirements)
    .where(eq(taskRequirements.id, reqId));
  if (!req) throw notFound('Requirement', reqId);

  const tests = await db
    .select()
    .from(requirementTests)
    .where(eq(requirementTests.requirementId, reqId))
    .orderBy(asc(requirementTests.sortOrder));

  return { ...req, tests };
}

// ---------------------------------------------------------------------------
// Requirement Tests
// ---------------------------------------------------------------------------

export async function addRequirementTest(reqId: string, description: string) {
  const [req] = await db
    .select()
    .from(taskRequirements)
    .where(eq(taskRequirements.id, reqId));
  if (!req) throw notFound('Requirement', reqId);

  const existing = await db
    .select()
    .from(requirementTests)
    .where(eq(requirementTests.requirementId, reqId));

  const test = {
    id: nanoid(),
    requirementId: reqId,
    description,
    passed: false,
    sortOrder: existing.length,
  };
  await db.insert(requirementTests).values(test);
  return test;
}

export async function updateRequirementTest(
  reqId: string,
  testId: string,
  patch: { description?: string; passed?: boolean },
) {
  const [test] = await db
    .select()
    .from(requirementTests)
    .where(
      and(eq(requirementTests.id, testId), eq(requirementTests.requirementId, reqId)),
    );
  if (!test) throw notFound('RequirementTest', testId);

  const updates: Partial<typeof test> = {};
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.passed !== undefined) updates.passed = patch.passed;

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, 'No test updates provided');
  }

  await db.update(requirementTests).set(updates).where(eq(requirementTests.id, testId));

  const [updated] = await db
    .select()
    .from(requirementTests)
    .where(eq(requirementTests.id, testId));
  return updated;
}

export async function passRequirementTest(reqId: string, testId: string) {
  return updateRequirementTest(reqId, testId, { passed: true });
}

export async function unpassRequirementTest(reqId: string, testId: string) {
  return updateRequirementTest(reqId, testId, { passed: false });
}

export async function deleteRequirementTest(reqId: string, testId: string) {
  const [test] = await db
    .select()
    .from(requirementTests)
    .where(
      and(eq(requirementTests.id, testId), eq(requirementTests.requirementId, reqId)),
    );
  if (!test) throw notFound('RequirementTest', testId);

  await db.delete(requirementTests).where(eq(requirementTests.id, testId));
}
