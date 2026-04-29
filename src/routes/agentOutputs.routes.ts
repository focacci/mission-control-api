import type { FastifyInstance } from 'fastify';
import * as outputsService from '../services/agentOutputs.service.js';
import {
  AppendAgentOutputStepSchema,
  CompleteAgentOutputSchema,
  CreateAgentOutputSchema,
  FailAgentOutputSchema,
} from '../types/index.types.js';

export async function agentOutputsRoutes(app: FastifyInstance) {
  // GET /api/agent-outputs — aggregate list across all assignments, newest first
  app.get('/api/agent-outputs', async () => {
    return outputsService.listAllAgentOutputs();
  });

  app.get('/api/agent-assignments/:id/outputs', async request => {
    const { id } = request.params as { id: string };
    return outputsService.listAgentOutputsForAssignment(id);
  });

  app.post('/api/agent-assignments/:id/outputs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = CreateAgentOutputSchema.parse(request.body);
    const output = await outputsService.createAgentOutput(id, parsed);
    return reply.status(201).send(output);
  });

  app.get('/api/agent-outputs/:id', async request => {
    const { id } = request.params as { id: string };
    return outputsService.getAgentOutput(id);
  });

  app.delete('/api/agent-outputs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await outputsService.deleteAgentOutput(id);
    return reply.status(204).send();
  });

  app.post('/api/agent-outputs/:id/steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AppendAgentOutputStepSchema.parse(request.body);
    const step = await outputsService.appendAgentOutputStep(id, parsed);
    return reply.status(201).send(step);
  });

  app.post('/api/agent-outputs/:id/complete', async request => {
    const { id } = request.params as { id: string };
    const parsed = CompleteAgentOutputSchema.parse(request.body);
    return outputsService.completeAgentOutput(id, parsed);
  });

  app.post('/api/agent-outputs/:id/fail', async request => {
    const { id } = request.params as { id: string };
    const parsed = FailAgentOutputSchema.parse(request.body);
    return outputsService.failAgentOutput(id, parsed);
  });
}
