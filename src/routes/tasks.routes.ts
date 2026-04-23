import type { FastifyInstance } from 'fastify';
import * as tasksService from '../services/tasks.service.js';
import * as requirementsService from '../services/requirements.service.js';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  DoneTaskSchema,
  BlockTaskSchema,
  AddRequirementSchema,
} from '../types/index.types.js';

export async function tasksRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // Tasks CRUD
  // ---------------------------------------------------------------------------

  // GET /api/tasks
  app.get('/api/tasks', async request => {
    const query = request.query as Record<string, string | string[] | undefined>;
    const status = query.status;
    return tasksService.listTasks({
      initiativeId: typeof query.initiativeId === 'string' ? query.initiativeId : undefined,
      status,
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
  // Requirement creation (scoped under task for convenience)
  // ---------------------------------------------------------------------------

  // POST /api/tasks/:id/requirements
  app.post('/api/tasks/:id/requirements', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddRequirementSchema.parse(request.body);
    const req = await requirementsService.addRequirement(id, parsed.description);
    return reply.status(201).send(req);
  });
}
