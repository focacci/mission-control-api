import type { FastifyInstance } from 'fastify';
import * as service from '../services/briefs.service.js';
import {
  AppendBriefEvidenceSchema,
  GenerateBriefSchema,
  ListBriefsQuerySchema,
  UpdateBriefSchema,
} from '../types/index.types.js';

export async function briefsRoutes(app: FastifyInstance) {
  app.get('/api/briefs', async request => {
    const parsed = ListBriefsQuerySchema.parse(request.query);
    return service.listBriefs(parsed);
  });

  app.get('/api/briefs/by-date/:date', async request => {
    const { date } = request.params as { date: string };
    return service.getBriefsByDate(date);
  });

  app.get('/api/briefs/:id', async request => {
    const { id } = request.params as { id: string };
    // Lazy-finalize on read: if revealAt has passed but the brief is still
    // drafting (server was down at reveal time), freeze it now so the user
    // never sees a half-baked brief in the UI.
    await service.maybeLazyFinalize(id);
    return service.getBrief(id);
  });

  app.post('/api/briefs/generate', async request => {
    const parsed = GenerateBriefSchema.parse(request.body);
    return service.generateBrief(parsed);
  });

  app.post('/api/briefs/:id/evidence', async request => {
    const { id } = request.params as { id: string };
    const parsed = AppendBriefEvidenceSchema.parse(request.body);
    return service.appendBriefEvidence(id, parsed.item);
  });

  app.post('/api/briefs/:id/finalize', async request => {
    const { id } = request.params as { id: string };
    return service.finalizeBrief(id);
  });

  app.post('/api/briefs/:id/acknowledge', async request => {
    const { id } = request.params as { id: string };
    return service.acknowledgeBrief(id);
  });

  app.patch('/api/briefs/:id', async request => {
    const { id } = request.params as { id: string };
    const parsed = UpdateBriefSchema.parse(request.body);
    return service.updateBrief(id, parsed);
  });

  app.delete('/api/briefs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.deleteBrief(id);
    return reply.status(204).send();
  });
}
