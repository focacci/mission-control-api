import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { db } from './db/client.js';
import { goals } from './db/schema.js';
import { sql } from 'drizzle-orm';
import { goalsRoutes } from './routes/goals.routes.js';
import { initiativesRoutes } from './routes/initiatives.routes.js';
import { tasksRoutes } from './routes/tasks.routes.js';
import { requirementsRoutes } from './routes/requirements.routes.js';
import { agentAssignmentsRoutes } from './routes/agentAssignments.routes.js';
import { agentOutputsRoutes } from './routes/agentOutputs.routes.js';
import { scheduleRoutes } from './routes/schedule.routes.js';
import { boardRoutes } from './routes/board.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { agentsRoutes } from './routes/agents.routes.js';
import { conversationsRoutes } from './routes/conversations.routes.js';
import { invocationsRoutes } from './routes/invocations.routes.js';
import { profileRoutes } from './routes/profile.routes.js';
import { contextGroupsRoutes } from './routes/contextGroups.routes.js';
import { briefsRoutes } from './routes/briefs.routes.js';
import { AppError } from './types/index.types.js';
import { ZodError } from 'zod';
import { initGatewayClient, loadOrCreateDeviceIdentity } from './agent/gatewayClient.js';
import { startSlotTicker } from './agent/slotTicker.js';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 3737);
const HOST = '0.0.0.0';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// ---------------------------------------------------------------------------
// Gateway WS client (singleton)
// ---------------------------------------------------------------------------
const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789';
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
// Shared-token auth grants zero scopes on its own. Present a signed Ed25519
// attestation on every connect so the gateway auto-pairs and issues a scoped
// device token (persisted next to the keypair for subsequent reconnects).
const deviceIdentity = loadOrCreateDeviceIdentity(
  path.resolve(process.cwd(), 'data', 'device-identity.json'),
);
const gateway = initGatewayClient({
  url: gatewayUrl,
  token: gatewayToken,
  deviceIdentity,
  deviceTokenStorePath: path.resolve(process.cwd(), 'data', 'gateway-device-token.json'),
  clientDisplayName: 'mission-control-api',
  logger: app.log as unknown as Console,
});
gateway.connect().catch((err) => {
  app.log.warn({ err }, 'gateway initial connect failed; reconnect loop will retry');
});

app.setErrorHandler((err, _request, reply) => {
  if (err instanceof AppError) {
    return reply.status(err.statusCode).send({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err instanceof ZodError) {
    return reply.status(400).send({
      error: 'Validation failed',
      details: err.flatten(),
    });
  }

  app.log.error(err);
  return reply.status(500).send({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', async () => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(goals);
  return {
    status: 'ok',
    goals: count,
    gateway: {
      connected: gateway.isReady,
      lastHelloAt: gateway.lastHelloAt,
      deviceTokenPresent: Boolean(gateway.deviceToken),
    },
  };
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
await app.register(goalsRoutes);
await app.register(initiativesRoutes);
await app.register(tasksRoutes);
await app.register(requirementsRoutes);
await app.register(agentAssignmentsRoutes);
await app.register(agentOutputsRoutes);
await app.register(scheduleRoutes);
await app.register(boardRoutes);
await app.register(chatRoutes);
await app.register(conversationsRoutes);
await app.register(invocationsRoutes);
await app.register(agentsRoutes);
await app.register(profileRoutes);
await app.register(contextGroupsRoutes);
await app.register(briefsRoutes);

// ---------------------------------------------------------------------------
// Slot ticker — fires due slots every 60s
// ---------------------------------------------------------------------------
const stopSlotTicker = startSlotTicker({ logger: app.log as unknown as Console });
const shutdown = () => {
  try { stopSlotTicker(); } catch { /* ignore */ }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Mission Control API running on http://localhost:${PORT}`);
  app.log.info(`Health:       http://localhost:${PORT}/health`);
  app.log.info(`Goals:        http://localhost:${PORT}/api/goals`);
  app.log.info(`Initiatives:  http://localhost:${PORT}/api/initiatives`);
  app.log.info(`Tasks:        http://localhost:${PORT}/api/tasks`);
  app.log.info(`Schedule:     http://localhost:${PORT}/api/schedule/today`);
  app.log.info(`Board:        http://localhost:${PORT}/api/board`);
  app.log.info(`Agents:       http://localhost:${PORT}/api/agents`);
  app.log.info(`Sessions:     http://localhost:${PORT}/api/chat/sessions`);
  app.log.info(`Invocations:  http://localhost:${PORT}/api/invocations`);
  app.log.info(`Profile:      http://localhost:${PORT}/api/profile`);
  app.log.info(`Contexts:     http://localhost:${PORT}/api/pinned-contexts`);
  app.log.info(`Briefs:       http://localhost:${PORT}/api/briefs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
