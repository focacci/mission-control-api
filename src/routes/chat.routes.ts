import { FastifyInstance } from 'fastify';
import { handleChatTurn, runBufferedChatTurn } from '../agent/chatOrchestrator.js';
import { serialize, type AgentEvent } from '../agent/events.js';
import { ChatRequestSchema } from '../types/index.types.js';

const HEARTBEAT_MS = 15_000;
// 4 MiB. If a slow consumer lets us buffer past this, the runner is detached
// so the turn keeps going — but this socket gets the boot.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

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

  // POST /api/chat/stream — SSE streaming chat turn. Same request shape as
  // /api/chat; emits `AgentEvent` frames via `serialize()` until `done` or a
  // fatal `error`. Detached-runner semantics: client disconnect does NOT
  // cancel the in-flight invocation; iOS resumes via the activity endpoint.
  app.post('/api/chat/stream', async (request, reply) => {
    const parsed = ChatRequestSchema.parse(request.body);
    // Tell Fastify we own the response — we write to raw and end it ourselves.
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.flushHeaders?.();

    let closed = false;

    const writeFrame = (frame: string): boolean => {
      if (closed || raw.writableEnded || raw.destroyed) return false;
      if (raw.writableLength > MAX_BUFFERED_BYTES) {
        closed = true;
        try {
          raw.destroy(new Error('sse backpressure ceiling'));
        } catch {
          /* ignore */
        }
        return false;
      }
      return raw.write(frame);
    };

    const writeEvent = (e: AgentEvent) => {
      writeFrame(serialize(e));
    };

    const heartbeat = setInterval(() => {
      writeEvent({ type: 'ping', ts: new Date().toISOString() });
    }, HEARTBEAT_MS);

    // Detect actual client disconnects via the response socket. Watching
    // `request.raw` ('close' on IncomingMessage) is unreliable in Node 18+:
    // it fires when the request body stream finishes — which Fastify does
    // before this handler ever runs — instantly poisoning `closed`,
    // clearing the heartbeat, and making every `writeFrame` return false.
    // The result is a 200 + headers + zero body, which is exactly what we
    // observed end-to-end.
    raw.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
    });

    try {
      await handleChatTurn({
        message: parsed.message.trim(),
        agentId: parsed.agentId,
        context: parsed.context,
        sessionId: parsed.sessionId,
        onEvent: writeEvent,
      });
    } catch (err) {
      // handleChatTurn already swallows runner errors that were classified
      // and emitted via onEvent. This catch only fires for unexpected throws
      // (e.g. DB blowups during session resolve / startInvocation).
      request.log.error({ err }, 'chat stream unexpected error');
      if (!closed) {
        writeEvent({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
          code: 'transport',
          fatal: true,
        });
      }
    } finally {
      clearInterval(heartbeat);
      if (!closed && !raw.writableEnded) {
        try {
          raw.end();
        } catch {
          /* ignore */
        }
      }
    }
  });
}
