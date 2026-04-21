import type { FastifyInstance } from 'fastify';
import * as conversationsService from '../services/conversations.service.js';
import {
  CreateSessionSchema,
  ListMessagesQuerySchema,
  ListSessionsQuerySchema,
} from '../types/index.types.js';

export async function conversationsRoutes(app: FastifyInstance) {
  // GET /api/chat/sessions — list sessions, optionally filtered
  app.get('/api/chat/sessions', async request => {
    const query = ListSessionsQuerySchema.parse(request.query);
    return conversationsService.listSessions(query);
  });

  // POST /api/chat/sessions — explicitly create a fresh session. Use this
  // instead of relying on findOrCreateSession when the caller wants a
  // brand-new thread for the same (agentId, contextType, contextId) combo.
  app.post('/api/chat/sessions', async (request, reply) => {
    const body = CreateSessionSchema.parse(request.body);
    const session = await conversationsService.createSession(body);
    return reply.status(201).send(session);
  });

  // GET /api/chat/sessions/:id — session metadata + message count
  app.get('/api/chat/sessions/:id', async request => {
    const { id } = request.params as { id: string };
    const session = await conversationsService.getSession(id);
    const messageCount = await conversationsService.getMessageCount(id);
    return { ...session, messageCount };
  });

  // GET /api/chat/sessions/:id/messages — paginated transcript
  app.get('/api/chat/sessions/:id/messages', async request => {
    const { id } = request.params as { id: string };
    const query = ListMessagesQuerySchema.parse(request.query);
    // Trigger a 404 if the session doesn't exist.
    await conversationsService.getSession(id);
    return conversationsService.listMessages(id, query);
  });

  // DELETE /api/chat/sessions/:id — hard delete, cascades messages + tool calls
  app.delete('/api/chat/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await conversationsService.deleteSession(id);
    return reply.status(204).send();
  });
}
