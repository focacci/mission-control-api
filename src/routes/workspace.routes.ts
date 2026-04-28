import { createReadStream, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getSession } from '../services/conversations.service.js';
import { AppError, notFound } from '../types/index.types.js';

const WORKSPACE_PATH =
  process.env.WORKSPACE_PATH ?? `${process.env.HOME ?? ''}/.openclaw/workspace`;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
};

export async function workspaceRoutes(app: FastifyInstance) {
  // GET /api/workspace/attachments/:sessionId/:filename — serve a file written
  // by the `attach` MCP tool out of `WORKSPACE_PATH/attachments/<sessionId>/`.
  // Mirrors the `workspace://` URLs returned by `saveAttachment`.
  //
  // Auth: full agent-owns-session enforcement waits on the auth middleware
  // (Phase 2 slice 9). Until then we at least require the session to exist —
  // this rejects probes for unknown ids and gives slice 9 a single chokepoint
  // to extend.
  app.get<{
    Params: { sessionId: string; filename: string };
  }>('/api/workspace/attachments/:sessionId/:filename', async (request, reply) => {
    const { sessionId, filename } = request.params;

    // Reject any path component that could escape the session directory. The
    // route only exposes a single filename segment, but defense-in-depth.
    if (
      filename.includes('/') ||
      filename.includes('\\') ||
      filename.includes('\0') ||
      filename === '.' ||
      filename === '..' ||
      filename.startsWith('.')
    ) {
      throw new AppError(400, 'Invalid filename.');
    }

    // 404 if the session doesn't exist (also covers the auth shape — once the
    // middleware lands, swap this for `assertSessionOwnedByAgent(...)`).
    await getSession(sessionId);

    const baseDir = normalize(join(WORKSPACE_PATH, 'attachments', sessionId));
    const filePath = normalize(join(baseDir, filename));
    if (!filePath.startsWith(baseDir + sep) && filePath !== baseDir) {
      throw new AppError(400, 'Invalid filename.');
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      throw notFound('Attachment', filename);
    }
    if (!stat.isFile()) throw notFound('Attachment', filename);

    const ext = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
      : '';
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';

    reply
      .header('Content-Type', mime)
      .header('Content-Length', String(stat.size))
      .header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(filePath));
  });
}
