import { FastifyInstance } from 'fastify';
import { chatService } from '../services/chat.service.js';

export async function chatRoutes(app: FastifyInstance) {
  // POST /api/chat — proxy a message to an OpenClaw agent (defaults to intella)
  app.post('/api/chat', async (request, reply) => {
    const { message, agentId, context, sessionId } = request.body as {
      message: string;
      agentId?: string;
      context?: {
        type: string;
        id?: string;
        name?: string;
        emoji?: string;
        section?: string;
        date?: string;
      };
      sessionId?: string;
    };

    if (!message?.trim()) {
      return reply.status(400).send({ error: 'message is required' });
    }

    const result = await chatService.sendMessage({
      message: message.trim(),
      agentId,
      context,
      sessionId,
    });

    return result;
  });
}
