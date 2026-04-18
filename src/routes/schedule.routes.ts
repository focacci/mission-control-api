import type { FastifyInstance } from 'fastify';
import * as scheduleService from '../services/schedule.service.js';
import {
  GenerateWeekPlanSchema,
  UpdateSlotSchema,
  DoneSlotSchema,
  SkipSlotSchema,
  AssignTaskSchema,
} from '../types/index.types.js';

export async function scheduleRoutes(app: FastifyInstance) {
  // GET /api/schedule/today
  app.get('/api/schedule/today', async () => {
    return scheduleService.getTodaySlots();
  });

  // GET /api/schedule/week?weekStart=YYYY-MM-DD
  app.get('/api/schedule/week', async request => {
    const query = request.query as Record<string, string | undefined>;
    const weekStart = query.weekStart ?? new Date().toISOString().slice(0, 10);
    return scheduleService.getWeekSlots(weekStart);
  });

  // POST /api/schedule/generate
  app.post('/api/schedule/generate', async (request, reply) => {
    const parsed = GenerateWeekPlanSchema.parse(request.body);
    const result = await scheduleService.generateWeekPlan(parsed.weekStart);
    return reply.status(201).send(result);
  });

  // POST /api/schedule/sync  (Phase 4 stub)
  app.post('/api/schedule/sync', async () => {
    return { synced: false, message: 'Obsidian sync not yet implemented (Phase 4)' };
  });

  // PATCH /api/schedule/slots/:id
  app.patch('/api/schedule/slots/:id', async request => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSlotSchema.parse(request.body);
    return scheduleService.updateSlot(id, parsed);
  });

  // POST /api/schedule/slots/:id/done
  app.post('/api/schedule/slots/:id/done', async request => {
    const { id } = request.params as { id: string };
    const parsed = DoneSlotSchema.parse(request.body ?? {});
    return scheduleService.doneSlot(id, parsed);
  });

  // POST /api/schedule/slots/:id/skip
  app.post('/api/schedule/slots/:id/skip', async request => {
    const { id } = request.params as { id: string };
    const parsed = SkipSlotSchema.parse(request.body ?? {});
    return scheduleService.skipSlot(id, parsed);
  });

  // POST /api/schedule/assign
  app.post('/api/schedule/assign', async request => {
    const parsed = AssignTaskSchema.parse(request.body);
    return scheduleService.assignTask(parsed.taskId, parsed.slotId);
  });
}
