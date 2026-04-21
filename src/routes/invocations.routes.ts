import type { FastifyInstance } from 'fastify';
import * as invocationsService from '../services/invocations.service.js';
import { ListInvocationsQuerySchema } from '../types/index.types.js';

export async function invocationsRoutes(app: FastifyInstance) {
  // GET /api/invocations — list invocations with optional filters
  app.get('/api/invocations', async request => {
    const query = ListInvocationsQuerySchema.parse(request.query);
    return invocationsService.listInvocations(query);
  });

  // GET /api/invocations/:id — full detail (messages + tool calls) for debugging
  app.get('/api/invocations/:id', async request => {
    const { id } = request.params as { id: string };
    return invocationsService.getInvocation(id);
  });
}
