import { FastifyInstance } from 'fastify';
import { chatService } from '../services/chat.service.js';
import { ChatRequestSchema } from '../types/index.types.js';

export async function chatRoutes(app: FastifyInstance) {
  // POST /api/chat — send a message to an agent. Persists user + assistant
  // messages, creates an agent_invocations row, and proxies through openclaw
  // (Phase 1: the in-process runner lands in Phase 2).
  app.post('/api/chat', async request => {
    const parsed = ChatRequestSchema.parse(request.body);
    return chatService.sendMessage({
      message: parsed.message.trim(),
      agentId: parsed.agentId,
      context: parsed.context,
      sessionId: parsed.sessionId,
    });
  });
}
