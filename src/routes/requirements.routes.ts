import type { FastifyInstance } from 'fastify';
import * as requirementsService from '../services/requirements.service.js';
import {
  UpdateRequirementSchema,
  AddRequirementTestSchema,
  UpdateRequirementTestSchema,
} from '../types/index.types.js';

export async function requirementsRoutes(app: FastifyInstance) {
  // PATCH /api/requirements/:reqId
  app.patch('/api/requirements/:reqId', async request => {
    const { reqId } = request.params as { reqId: string };
    const parsed = UpdateRequirementSchema.parse(request.body);
    return requirementsService.updateRequirement(reqId, parsed);
  });

  // POST /api/requirements/:reqId/check
  app.post('/api/requirements/:reqId/check', async request => {
    const { reqId } = request.params as { reqId: string };
    return requirementsService.checkRequirement(reqId, true);
  });

  // POST /api/requirements/:reqId/uncheck
  app.post('/api/requirements/:reqId/uncheck', async request => {
    const { reqId } = request.params as { reqId: string };
    return requirementsService.checkRequirement(reqId, false);
  });

  // DELETE /api/requirements/:reqId
  app.delete('/api/requirements/:reqId', async (request, reply) => {
    const { reqId } = request.params as { reqId: string };
    await requirementsService.deleteRequirement(reqId);
    return reply.status(204).send();
  });

  // --------------------------------------------------------------------------
  // Requirement tests
  // --------------------------------------------------------------------------

  // POST /api/requirements/:reqId/tests
  app.post('/api/requirements/:reqId/tests', async (request, reply) => {
    const { reqId } = request.params as { reqId: string };
    const parsed = AddRequirementTestSchema.parse(request.body);
    const test = await requirementsService.addRequirementTest(reqId, parsed.description);
    return reply.status(201).send(test);
  });

  // PATCH /api/requirements/:reqId/tests/:testId
  app.patch('/api/requirements/:reqId/tests/:testId', async request => {
    const { reqId, testId } = request.params as { reqId: string; testId: string };
    const parsed = UpdateRequirementTestSchema.parse(request.body);
    return requirementsService.updateRequirementTest(reqId, testId, parsed);
  });

  // POST /api/requirements/:reqId/tests/:testId/pass
  app.post('/api/requirements/:reqId/tests/:testId/pass', async request => {
    const { reqId, testId } = request.params as { reqId: string; testId: string };
    return requirementsService.passRequirementTest(reqId, testId);
  });

  // POST /api/requirements/:reqId/tests/:testId/unpass
  app.post('/api/requirements/:reqId/tests/:testId/unpass', async request => {
    const { reqId, testId } = request.params as { reqId: string; testId: string };
    return requirementsService.unpassRequirementTest(reqId, testId);
  });

  // DELETE /api/requirements/:reqId/tests/:testId
  app.delete('/api/requirements/:reqId/tests/:testId', async (request, reply) => {
    const { reqId, testId } = request.params as { reqId: string; testId: string };
    await requirementsService.deleteRequirementTest(reqId, testId);
    return reply.status(204).send();
  });
}
