import type { FastifyInstance } from 'fastify';
import { hydrateCards } from '../services/cards.service.js';
import { HydrateCardsSchema } from '../types/index.types.js';

export async function cardsRoutes(app: FastifyInstance) {
  // POST /api/cards/hydrate — bulk-hydrate card refs emitted by `render_card`
  // parts. Used by the iOS chat renderer to fill an EntityCache in a single
  // round-trip rather than fanning out to /api/tasks/:id, /api/goals/:id, etc.
  app.post('/api/cards/hydrate', async request => {
    const { cards } = HydrateCardsSchema.parse(request.body);
    return hydrateCards(cards);
  });
}
