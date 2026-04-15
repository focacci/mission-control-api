import type { FastifyInstance } from 'fastify';
import * as tasksService from '../services/tasks.service.js';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  DoneTaskSchema,
  BlockTaskSchema,
  AddRequirementSchema,
  UpdateRequirementSchema,
  AddTestSchema,
  UpdateTestSchema,
  AddOutputSchema,
} from '../types/index.types.js';

export async function tasksRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Tasks CRUD
  // ---------------------------------------------------------------------------

  // GET /api/tasks
  app.get('/api/tasks', async request => {
    const query = request.query as Record<string, string | string[] | undefined>;
    // status may be a single value or repeated: ?status=pending&status=assigned
    const status = query.status;
    return tasksService.listTasks({
      initiativeId: typeof query.initiativeId === 'string' ? query.initiativeId : undefined,
      status,
      includeDeleted: query.includeDeleted === 'true',
    });
  });

  // GET /api/tasks/:id
  app.get('/api/tasks/:id', async request => {
    const { id } = request.params as { id: string };
    return tasksService.getTask(id);
  });

  // POST /api/tasks
  app.post('/api/tasks', async (request, reply) => {
    const parsed = CreateTaskSchema.parse(request.body);
    const task = await tasksService.createTask(parsed);
    return reply.status(201).send(task);
  });

  // PATCH /api/tasks/:id
  app.patch('/api/tasks/:id', async request => {
    const { id } = request.params as { id: string };
    const parsed = UpdateTaskSchema.parse(request.body);
    return tasksService.updateTask(id, parsed);
  });

  // POST /api/tasks/:id/start
  app.post('/api/tasks/:id/start', async request => {
    const { id } = request.params as { id: string };
    return tasksService.startTask(id);
  });

  // POST /api/tasks/:id/done
  app.post('/api/tasks/:id/done', async request => {
    const { id } = request.params as { id: string };
    const parsed = DoneTaskSchema.parse(request.body);
    return tasksService.doneTask(id, parsed);
  });

  // POST /api/tasks/:id/block
  app.post('/api/tasks/:id/block', async request => {
    const { id } = request.params as { id: string };
    const parsed = BlockTaskSchema.parse(request.body);
    return tasksService.blockTask(id, parsed);
  });

  // POST /api/tasks/:id/cancel
  app.post('/api/tasks/:id/cancel', async request => {
    const { id } = request.params as { id: string };
    return tasksService.cancelTask(id);
  });

  // DELETE /api/tasks/:id
  app.delete('/api/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await tasksService.deleteTask(id);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Requirements
  // ---------------------------------------------------------------------------

  // POST /api/tasks/:id/requirements
  app.post('/api/tasks/:id/requirements', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddRequirementSchema.parse(request.body);
    const req = await tasksService.addRequirement(id, parsed.description);
    return reply.status(201).send(req);
  });

  // PATCH /api/tasks/:taskId/requirements/:reqId
  app.patch('/api/tasks/:taskId/requirements/:reqId', async request => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string };
    const parsed = UpdateRequirementSchema.parse(request.body);
    return tasksService.updateRequirement(taskId, reqId, parsed);
  });

  // POST /api/tasks/:taskId/requirements/:reqId/check
  app.post('/api/tasks/:taskId/requirements/:reqId/check', async request => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string };
    return tasksService.checkRequirement(taskId, reqId, true);
  });

  // POST /api/tasks/:taskId/requirements/:reqId/uncheck
  app.post('/api/tasks/:taskId/requirements/:reqId/uncheck', async request => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string };
    return tasksService.checkRequirement(taskId, reqId, false);
  });

  // DELETE /api/tasks/:taskId/requirements/:reqId
  app.delete('/api/tasks/:taskId/requirements/:reqId', async (request, reply) => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string };
    await tasksService.deleteRequirement(taskId, reqId);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  // POST /api/tasks/:id/tests
  app.post('/api/tasks/:id/tests', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddTestSchema.parse(request.body);
    const test = await tasksService.addTest(id, parsed.description);
    return reply.status(201).send(test);
  });

  // PATCH /api/tasks/:taskId/tests/:testId
  app.patch('/api/tasks/:taskId/tests/:testId', async request => {
    const { taskId, testId } = request.params as { taskId: string; testId: string };
    const parsed = UpdateTestSchema.parse(request.body);
    return tasksService.updateTest(taskId, testId, parsed);
  });

  // DELETE /api/tasks/:taskId/tests/:testId
  app.delete('/api/tasks/:taskId/tests/:testId', async (request, reply) => {
    const { taskId, testId } = request.params as { taskId: string; testId: string };
    await tasksService.deleteTest(taskId, testId);
    return reply.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // Outputs
  // ---------------------------------------------------------------------------

  // POST /api/tasks/:id/outputs
  app.post('/api/tasks/:id/outputs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddOutputSchema.parse(request.body);
    const output = await tasksService.addOutput(id, parsed.label, parsed.url);
    return reply.status(201).send(output);
  });

  // DELETE /api/tasks/:taskId/outputs/:outputId
  app.delete('/api/tasks/:taskId/outputs/:outputId', async (request, reply) => {
    const { taskId, outputId } = request.params as { taskId: string; outputId: string };
    await tasksService.deleteOutput(taskId, outputId);
    return reply.status(204).send();
  });
}
