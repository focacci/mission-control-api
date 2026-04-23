import type { FastifyInstance } from 'fastify';
import * as service from '../services/contextGroups.service.js';
import {
  CreatePinnedContextSchema,
  CreateContextGroupSchema,
  UpdateContextGroupSchema,
  AddContextGroupMemberSchema,
} from '../types/index.types.js';

export async function contextGroupsRoutes(app: FastifyInstance) {
  // Pinned contexts
  app.get('/api/pinned-contexts', async () => service.listPinnedContexts());

  app.post('/api/pinned-contexts', async (request, reply) => {
    const parsed = CreatePinnedContextSchema.parse(request.body);
    const pinned = await service.createPinnedContext(parsed);
    return reply.status(201).send(pinned);
  });

  app.delete('/api/pinned-contexts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.deletePinnedContext(id);
    return reply.status(204).send();
  });

  // Context groups
  app.get('/api/context-groups', async () => service.listContextGroups());

  app.get('/api/context-groups/:id', async request => {
    const { id } = request.params as { id: string };
    return service.getContextGroup(id);
  });

  app.post('/api/context-groups', async (request, reply) => {
    const parsed = CreateContextGroupSchema.parse(request.body);
    const group = await service.createContextGroup(parsed);
    return reply.status(201).send(group);
  });

  app.patch('/api/context-groups/:id', async request => {
    const { id } = request.params as { id: string };
    const parsed = UpdateContextGroupSchema.parse(request.body);
    return service.updateContextGroup(id, parsed);
  });

  app.delete('/api/context-groups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.deleteContextGroup(id);
    return reply.status(204).send();
  });

  app.post('/api/context-groups/:id/members', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AddContextGroupMemberSchema.parse(request.body);
    const member = await service.addContextGroupMember(id, parsed);
    return reply.status(201).send(member);
  });

  app.delete('/api/context-groups/:groupId/members/:memberId', async (request, reply) => {
    const { groupId, memberId } = request.params as { groupId: string; memberId: string };
    await service.removeContextGroupMember(groupId, memberId);
    return reply.status(204).send();
  });
}
