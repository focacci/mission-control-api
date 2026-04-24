import { FastifyInstance } from 'fastify';
import { runBufferedChatTurn } from '../agent/chatOrchestrator.js';
import { ChatRequestSchema } from '../types/index.types.js';

export async function chatRoutes(app: FastifyInstance) {
  // POST /api/chat — buffered chat turn. Drives the Phase 2 in-process runner
  // via `handleChatTurn`, then returns the finalized assistant text once the
  // gateway `agent` RPC completes. Same request/response shape as Phase 1 so
  // iOS clients don't need to switch until `/api/chat/stream` ships.
  app.post('/api/chat', async request => {
    const parsed = ChatRequestSchema.parse(request.body);
    const result = await runBufferedChatTurn({
      message: parsed.message.trim(),
      agentId: parsed.agentId,
      context: parsed.context,
      sessionId: parsed.sessionId,
    });
    return {
      reply: result.reply,
      sessionId: result.sessionId,
      agentId: result.agentId,
      invocationId: result.invocationId,
    };
  });
}
