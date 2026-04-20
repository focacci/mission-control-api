import type { FastifyInstance } from 'fastify';
import * as agentsService from '../services/agents.service.js';
import { CreateAgentSchema, UpdateAgentSchema } from '../types/index.types.js';

export async function agentsRoutes(app: FastifyInstance) {
  // GET /api/agents — list agents (DB is source of truth, bootstraps from CLI on empty)
  app.get('/api/agents', async () => {
    return agentsService.listAgents();
  });

  // POST /api/agents/sync — reconcile DB against openclaw CLI
  app.post('/api/agents/sync', async () => {
    return agentsService.syncAgents();
  });

  // GET /api/agents/:id
  app.get('/api/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    return agentsService.getAgent(id);
  });

  // POST /api/agents — create an openclaw agent (write-through to DB)
  app.post('/api/agents', async (request, reply) => {
    const parsed = CreateAgentSchema.parse(request.body);
    const agent = await agentsService.createAgent(parsed);
    return reply.status(201).send(agent);
  });

  // PATCH /api/agents/:id — update editable fields (currently systemPrompt)
  app.patch('/api/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateAgentSchema.parse(request.body);
    return agentsService.updateAgent(id, parsed);
  });

  // DELETE /api/agents/:id
  app.delete('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await agentsService.deleteAgent(id);
    return reply.status(204).send();
  });
}
