import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { db } from './db/client.js';
import { goals } from './db/schema.js';
import { sql } from 'drizzle-orm';
import { goalsRoutes } from './routes/goals.routes.js';
import { initiativesRoutes } from './routes/initiatives.routes.js';
import { tasksRoutes } from './routes/tasks.routes.js';
import { scheduleRoutes } from './routes/schedule.routes.js';
import { boardRoutes } from './routes/board.routes.js';
import { AppError } from './types/index.types.js';
import { ZodError } from 'zod';

const PORT = Number(process.env.PORT ?? 3737);
const HOST = '0.0.0.0';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

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
  return { status: 'ok', goals: count };
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
await app.register(goalsRoutes);
await app.register(initiativesRoutes);
await app.register(tasksRoutes);
await app.register(scheduleRoutes);
await app.register(boardRoutes);

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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
