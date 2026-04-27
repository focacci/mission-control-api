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

  // POST /api/invocations/:id/cancel — abort a running gateway session.
  // Returns 200 `{ cancelled: true, reconciled? }`, 404 if missing, 409 if
  // the invocation isn't running. The runner's lifecycle-error handler is
  // what writes the final `status='cancelled'`; this route only kicks off
  // the abort and reconciles stale rows when the gateway no longer knows
  // about the session.
  app.post('/api/invocations/:id/cancel', async request => {
    const { id } = request.params as { id: string };
    return invocationsService.cancelInvocation(id);
  });
}
