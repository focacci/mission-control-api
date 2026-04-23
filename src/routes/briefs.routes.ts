import type { FastifyInstance } from 'fastify';
import * as service from '../services/briefs.service.js';
import {
  ListBriefsQuerySchema,
  GenerateBriefSchema,
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
    return service.getBrief(id);
  });

  app.post('/api/briefs/generate', async request => {
    const parsed = GenerateBriefSchema.parse(request.body);
    return service.generateBrief(parsed);
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
