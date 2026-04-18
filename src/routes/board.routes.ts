import type { FastifyInstance } from 'fastify';
import * as boardService from '../services/board.service.js';

export async function boardRoutes(app: FastifyInstance) {
  // GET /api/board
  app.get('/api/board', async () => {
    return boardService.getBoard();
  });

  // POST /api/board/refresh  (Phase 4 stub — regenerates Obsidian Board.md)
  app.post('/api/board/refresh', async () => {
    return { refreshed: false, message: 'Obsidian sync not yet implemented (Phase 4)' };
  });
}
