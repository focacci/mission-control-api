import type { FastifyInstance } from 'fastify';
import * as agentsService from '../services/agents.service.js';
import { CreateAgentSchema, UpdateAgentSchema } from '../types/index.types.js';

export async function agentsRoutes(app: FastifyInstance) {
  // GET /api/agents — list agents (DB is the source of truth; Intella only
  // tracks agents it created, never external openclaw agents)
  app.get('/api/agents', async () => {
    return agentsService.listAgents();
  });

  // POST /api/agents/repair — re-create any DB-tracked openclaw agents that
  // have gone missing from the CLI (including the default Intella agent)
  app.post('/api/agents/repair', async () => {
    return agentsService.repairAgents();
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
