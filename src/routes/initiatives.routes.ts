import type { FastifyInstance } from 'fastify';
import {
  listInitiatives,
  getInitiative,
  createInitiative,
  updateInitiative,
  completeInitiative,
  deleteInitiative,
} from '../services/initiatives.service.js';
import {
  CreateInitiativeSchema,
  UpdateInitiativeSchema,
} from '../types/index.types.js';

export async function initiativesRoutes(app: FastifyInstance) {
  // GET /api/initiatives
  app.get('/api/initiatives', async request => {
    const query = request.query as Record<string, string | undefined>;
    return listInitiatives({
      goalId: query.goalId,
      status: query.status,
      includeDeleted: query.includeDeleted === 'true',
    });
  });

  // GET /api/initiatives/:id
  app.get('/api/initiatives/:id', async request => {
    const { id } = request.params as { id: string };
    return getInitiative(id);
  });

  // POST /api/initiatives
  app.post('/api/initiatives', async (request, reply) => {
    const parsed = CreateInitiativeSchema.parse(request.body);
    const initiative = await createInitiative(parsed);
    return reply.status(201).send(initiative);
  });

  // PATCH /api/initiatives/:id
  app.patch('/api/initiatives/:id', async request => {
    const { id } = request.params as { id: string };
    const parsed = UpdateInitiativeSchema.parse(request.body);
    return updateInitiative(id, parsed);
  });

  // POST /api/initiatives/:id/complete
  app.post('/api/initiatives/:id/complete', async request => {
    const { id } = request.params as { id: string };
    return completeInitiative(id);
  });

  // DELETE /api/initiatives/:id
  app.delete('/api/initiatives/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteInitiative(id);
    return reply.status(204).send();
  });
}
