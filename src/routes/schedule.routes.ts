import type { FastifyInstance } from 'fastify';
import * as scheduleService from '../services/schedule.service.js';
import {
  GenerateWeekPlanSchema,
  UpdateSlotSchema,
  DoneSlotSchema,
  SkipSlotSchema,
  AssignAgentAssignmentSchema,
  AddSlotOutputSchema,
  AppError,
  today,
} from '../types/index.types.js';

export async function scheduleRoutes(app: FastifyInstance) {
  // GET /api/schedule/today
  app.get('/api/schedule/today', async () => {
    return scheduleService.getTodaySlots();
  });

  // GET /api/schedule/week?weekStart=YYYY-MM-DD
  app.get('/api/schedule/week', async request => {
    const query = request.query as Record<string, string | undefined>;
    const weekStart = query.weekStart ?? today();
    return scheduleService.getWeekSlots(weekStart);
  });

  // GET /api/schedule/range?from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get('/api/schedule/range', async request => {
    const query = request.query as Record<string, string | undefined>;
    const from = query.from;
    const to = query.to;
    if (!from || !to) {
      throw new AppError(400, '`from` and `to` query params are required');
    }
    return scheduleService.getSlotsInRange(from, to);
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
    const parsed = AssignAgentAssignmentSchema.parse(request.body);
    return scheduleService.assignAgentAssignment(parsed.agentAssignmentId, parsed.slotId);
  });

  // GET /api/schedule/suggest?agentAssignmentId=...&weekStart=YYYY-MM-DD&limit=N
  app.get('/api/schedule/suggest', async request => {
    const query = request.query as Record<string, string | undefined>;
    const agentAssignmentId = query.agentAssignmentId;
    if (!agentAssignmentId) {
      throw new AppError(400, '`agentAssignmentId` query param is required');
    }
    const limit = query.limit ? Number(query.limit) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      throw new AppError(400, '`limit` must be a positive number');
    }
    return scheduleService.suggestSlotsForAssignment(
      agentAssignmentId,
      query.weekStart,
      limit,
    );
  });

  // DELETE /api/schedule/slots/:id/assignment
  app.delete('/api/schedule/slots/:id/assignment', async request => {
    const { id } = request.params as { id: string };
    return scheduleService.unassignAgentAssignment(id);
  });

  // POST /api/schedule/slots/:id/outputs
  app.post('/api/schedule/slots/:id/outputs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddSlotOutputSchema.parse(request.body);
    const output = await scheduleService.addSlotOutput(id, parsed);
    return reply.status(201).send(output);
  });

  // DELETE /api/schedule/slots/:slotId/outputs/:outputId
  app.delete('/api/schedule/slots/:slotId/outputs/:outputId', async (request, reply) => {
    const { slotId, outputId } = request.params as { slotId: string; outputId: string };
    await scheduleService.deleteSlotOutput(slotId, outputId);
    return reply.status(204).send();
  });
}
