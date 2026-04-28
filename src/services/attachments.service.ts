import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { AppError } from '../types/index.types.js';

const WORKSPACE_PATH =
  process.env.WORKSPACE_PATH ?? `${process.env.HOME ?? ''}/.openclaw/workspace`;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/json': 'json',
};

export interface SaveAttachmentInput {
  sessionId: string;
  /** Caller-supplied display name (e.g. "screenshot.png"). Used as-is when
   *  the extension matches the mime type; otherwise the helper appends one. */
  name: string;
  mimeType: string;
  /** Base64-encoded payload. Mutually exclusive with `sourceUrl` upstream. */
  data: string;
}

export interface SavedAttachment {
  url: string;
  size: number;
  storedPath: string;
}

/** Persist a base64 payload under `WORKSPACE_PATH/attachments/<sessionId>/`
 *  and return a stable URL the iOS client can fetch. The URL is a relative
 *  workspace path so the file:// resolver on the device can locate it via
 *  the existing workspace mount; HTTP serving is out of scope for v1. */
export function saveAttachment(input: SaveAttachmentInput): SavedAttachment {
  if (!input.data) throw new AppError(400, 'attach: missing `data` payload.');
  const dir = join(WORKSPACE_PATH, 'attachments', input.sessionId);
  mkdirSync(dir, { recursive: true });

  const extFromName = input.name.includes('.')
    ? input.name.slice(input.name.lastIndexOf('.') + 1).toLowerCase()
    : '';
  const expectedExt = MIME_EXTENSIONS[input.mimeType] ?? extFromName;
  const safeBase = input.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const filename = `${nanoid(8)}-${safeBase}${
    expectedExt && !safeBase.endsWith(`.${expectedExt}`) ? `.${expectedExt}` : ''
  }`;
  const storedPath = join(dir, filename);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.data, 'base64');
  } catch (e) {
    throw new AppError(400, `attach: invalid base64 payload (${(e as Error).message}).`);
  }
  writeFileSync(storedPath, buffer);

  return {
    url: `workspace://attachments/${input.sessionId}/${filename}`,
    size: buffer.byteLength,
    storedPath,
  };
}
