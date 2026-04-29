import type { FastifyInstance } from 'fastify';
import * as aaService from '../services/agentAssignments.service.js';
import {
  CreateAgentAssignmentSchema,
  UpdateAgentAssignmentSchema,
} from '../types/index.types.js';

export async function agentAssignmentsRoutes(app: FastifyInstance) {
  // GET /api/agent-assignments — aggregate list across all parents, newest first
  app.get('/api/agent-assignments', async () => {
    return aaService.listAllAgentAssignments();
  });

  // GET /api/tasks/:taskId/agent-assignments
  app.get('/api/tasks/:taskId/agent-assignments', async request => {
    const { taskId } = request.params as { taskId: string };
    return aaService.listAgentAssignmentsForTask(taskId);
  });

  // POST /api/tasks/:taskId/agent-assignments
  app.post('/api/tasks/:taskId/agent-assignments', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const parsed = CreateAgentAssignmentSchema.parse(request.body);
    const aa = await aaService.createAgentAssignmentForParent('task', taskId, parsed);
    return reply.status(201).send(aa);
  });

  // GET /api/goals/:goalId/agent-assignments
  app.get('/api/goals/:goalId/agent-assignments', async request => {
    const { goalId } = request.params as { goalId: string };
    return aaService.listAgentAssignmentsForGoal(goalId);
  });

  // POST /api/goals/:goalId/agent-assignments
  app.post('/api/goals/:goalId/agent-assignments', async (request, reply) => {
    const { goalId } = request.params as { goalId: string };
    const parsed = CreateAgentAssignmentSchema.parse(request.body);
    const aa = await aaService.createAgentAssignmentForParent('goal', goalId, parsed);
    return reply.status(201).send(aa);
  });

  // GET /api/initiatives/:initiativeId/agent-assignments
  app.get('/api/initiatives/:initiativeId/agent-assignments', async request => {
    const { initiativeId } = request.params as { initiativeId: string };
    return aaService.listAgentAssignmentsForInitiative(initiativeId);
  });

  // POST /api/initiatives/:initiativeId/agent-assignments
  app.post('/api/initiatives/:initiativeId/agent-assignments', async (request, reply) => {
    const { initiativeId } = request.params as { initiativeId: string };
    const parsed = CreateAgentAssignmentSchema.parse(request.body);
    const aa = await aaService.createAgentAssignmentForParent('initiative', initiativeId, parsed);
    return reply.status(201).send(aa);
  });

  // GET /api/agent-assignments/:id
  app.get('/api/agent-assignments/:id', async request => {
    const { id } = request.params as { id: string };
    return aaService.getAgentAssignment(id);
  });

  // PATCH /api/agent-assignments/:id
  app.patch('/api/agent-assignments/:id', async request => {
    const { id } = request.params as { id: string };
    const parsed = UpdateAgentAssignmentSchema.parse(request.body);
    return aaService.updateAgentAssignment(id, parsed);
  });

  // POST /api/agent-assignments/:id/start
  app.post('/api/agent-assignments/:id/start', async request => {
    const { id } = request.params as { id: string };
    return aaService.startAgentAssignment(id);
  });

  // POST /api/agent-assignments/:id/complete
  app.post('/api/agent-assignments/:id/complete', async request => {
    const { id } = request.params as { id: string };
    return aaService.completeAgentAssignment(id);
  });

  // POST /api/agent-assignments/:id/block
  app.post('/api/agent-assignments/:id/block', async request => {
    const { id } = request.params as { id: string };
    return aaService.blockAgentAssignment(id);
  });

  // POST /api/agent-assignments/:id/reopen
  app.post('/api/agent-assignments/:id/reopen', async request => {
    const { id } = request.params as { id: string };
    return aaService.reopenAgentAssignment(id);
  });

  // POST /api/agent-assignments/:id/unassign
  app.post('/api/agent-assignments/:id/unassign', async request => {
    const { id } = request.params as { id: string };
    return aaService.unassignAgentAssignment(id);
  });

  // DELETE /api/agent-assignments/:id
  app.delete('/api/agent-assignments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await aaService.deleteAgentAssignment(id);
    return reply.status(204).send();
  });
}
