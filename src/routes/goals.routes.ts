import type { FastifyInstance } from 'fastify';
import {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
} from '../services/goals.service.js';
import {
  CreateGoalSchema,
  UpdateGoalSchema,
} from '../types/index.types.js';

export async function goalsRoutes(app: FastifyInstance) {
  // GET /api/goals
  app.get('/api/goals', async request => {
    const query = request.query as Record<string, string | undefined>;
    return listGoals({
      focus: query.focus,
      includeDeleted: query.includeDeleted === 'true',
    });
  });

  // GET /api/goals/:id
  app.get('/api/goals/:id', async request => {
    const { id } = request.params as { id: string };
    return getGoal(id);
  });

  // POST /api/goals
  app.post('/api/goals', async (request, reply) => {
    const parsed = CreateGoalSchema.parse(request.body);
    const goal = await createGoal(parsed);
    return reply.status(201).send(goal);
  });

  // PATCH /api/goals/:id
  app.patch('/api/goals/:id', async request => {
    const { id } = request.params as { id: string };
    const parsed = UpdateGoalSchema.parse(request.body);
    return updateGoal(id, parsed);
  });

  // DELETE /api/goals/:id
  app.delete('/api/goals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteGoal(id);
    return reply.status(204).send();
  });
}
