import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';
import {
  AppError,
  notFound,
  now,
  type CreateAgentInput,
  type UpdateAgentInput,
} from '../types/index.types.js';

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = 'openclaw';
const CMD_TIMEOUT_MS = 60_000;

export interface OpenclawAgent {
  id: string;
  name: string;
  identityName?: string | null;
  identityEmoji?: string | null;
  workspace: string;
  agentDir: string;
  model?: string | null;
  bindings: number;
  isDefault: boolean;
  systemPrompt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// openclaw CLI helpers
// ---------------------------------------------------------------------------

async function runOpenclaw(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(OPENCLAW_BIN, args, {
      timeout: CMD_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() ?? '';
    const msg = stderr.trim() || err.message;
    throw new AppError(500, `openclaw ${args.join(' ')} failed: ${msg}`);
  }
}

async function readSystemPrompt(workspace: string): Promise<string | null> {
  try {
    const txt = await readFile(join(workspace, 'SOUL.md'), 'utf8');
    const trimmed = txt.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function writeSystemPrompt(workspace: string, prompt: string | null): Promise<void> {
  const path = join(workspace, 'SOUL.md');
  if (prompt === null || prompt.trim() === '') {
    await rm(path, { force: true }).catch(() => {});
    return;
  }
  await mkdir(workspace, { recursive: true });
  await writeFile(path, prompt.trim() + '\n', 'utf8');
}

function normalizeId(name: string): string {
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) {
    throw new AppError(400, 'Agent name must contain letters, digits, or hyphens');
  }
  return safe;
}

function parseAgentsJson(stdout: string): OpenclawAgent[] {
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed as OpenclawAgent[];
  } catch (err: any) {
    throw new AppError(500, `Failed to parse openclaw output: ${err.message}`);
  }
}

async function readCliAgents(): Promise<OpenclawAgent[]> {
  const out = await runOpenclaw(['agents', 'list', '--json']);
  const raw = parseAgentsJson(out);
  return Promise.all(
    raw.map(async (a) => ({
      ...a,
      name: a.name ?? a.identityName ?? a.id,
      systemPrompt: await readSystemPrompt(a.workspace),
    })),
  );
}

// ---------------------------------------------------------------------------
// DB row shape → OpenclawAgent
// ---------------------------------------------------------------------------

function rowToAgent(row: typeof agents.$inferSelect): OpenclawAgent {
  return {
    id: row.id,
    name: row.name,
    identityName: row.identityName,
    identityEmoji: row.identityEmoji,
    workspace: row.workspace,
    agentDir: row.agentDir,
    model: row.model,
    bindings: row.bindings,
    isDefault: row.isDefault,
    systemPrompt: row.systemPrompt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Public API — DB is the source of truth for reads
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<OpenclawAgent[]> {
  const rows = await db.select().from(agents).orderBy(asc(agents.createdAt));
  if (rows.length === 0) {
    // DB empty — bootstrap from CLI so first-run returns agents that already exist
    const synced = await syncAgents();
    return synced;
  }
  return rows.map(rowToAgent);
}

export async function getAgent(id: string): Promise<OpenclawAgent> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  if (!row) throw notFound('Agent', id);
  return rowToAgent(row);
}

export async function createAgent(input: CreateAgentInput): Promise<OpenclawAgent> {
  const id = normalizeId(input.name);

  const [existing] = await db.select().from(agents).where(eq(agents.id, id));
  if (existing) {
    throw new AppError(409, `Agent already exists: ${id}`);
  }

  const workspace = join(homedir(), '.openclaw', 'agents', id, 'workspace');
  await mkdir(workspace, { recursive: true });

  const prompt = input.systemPrompt?.trim() ? input.systemPrompt.trim() : null;
  if (prompt) {
    await writeSystemPrompt(workspace, prompt);
  }

  await runOpenclaw([
    'agents',
    'add',
    id,
    '--workspace',
    workspace,
    '--model',
    input.model,
    '--non-interactive',
    '--json',
  ]);

  // Pull authoritative metadata back from the CLI so we pick up identity fields
  // that openclaw may have assigned (identityName/Emoji, agentDir, etc.).
  const cliAgents = await readCliAgents();
  const fromCli = cliAgents.find((a) => a.id === id);

  const timestamp = now();
  const row = {
    id,
    name: fromCli?.name ?? input.name,
    identityName: fromCli?.identityName ?? null,
    identityEmoji: fromCli?.identityEmoji ?? null,
    workspace: fromCli?.workspace ?? workspace,
    agentDir: fromCli?.agentDir ?? join(homedir(), '.openclaw', 'agents', id),
    model: fromCli?.model ?? input.model,
    bindings: fromCli?.bindings ?? 0,
    isDefault: fromCli?.isDefault ?? false,
    systemPrompt: prompt,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(agents).values(row);
  return rowToAgent(row);
}

export async function updateAgent(id: string, input: UpdateAgentInput): Promise<OpenclawAgent> {
  const [existing] = await db.select().from(agents).where(eq(agents.id, id));
  if (!existing) throw notFound('Agent', id);

  const updates: Partial<typeof existing> = { updatedAt: now() };

  if ('systemPrompt' in input) {
    const prompt = input.systemPrompt?.trim() ? input.systemPrompt.trim() : null;
    await writeSystemPrompt(existing.workspace, prompt);
    updates.systemPrompt = prompt;
  }

  await db.update(agents).set(updates).where(eq(agents.id, id));

  const [updated] = await db.select().from(agents).where(eq(agents.id, id));
  return rowToAgent(updated);
}

export async function deleteAgent(id: string): Promise<void> {
  const [existing] = await db.select().from(agents).where(eq(agents.id, id));
  if (!existing) throw notFound('Agent', id);
  if (existing.isDefault) {
    throw new AppError(400, `Cannot delete the default agent: ${id}`);
  }

  await runOpenclaw(['agents', 'delete', id, '--force', '--json']);

  const workspaceRoot = join(homedir(), '.openclaw', 'agents', id);
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});

  await db.delete(agents).where(eq(agents.id, id));
}

/**
 * Reconcile the DB against the openclaw CLI. Upserts every CLI agent and
 * removes DB rows that no longer exist in the CLI. Escape hatch when state
 * drifts (e.g. an agent was created/deleted via `openclaw` directly).
 */
export async function syncAgents(): Promise<OpenclawAgent[]> {
  const cliAgents = await readCliAgents();
  const timestamp = now();

  const existingRows = await db.select().from(agents);
  const existingById = new Map(existingRows.map((r) => [r.id, r]));

  db.transaction((tx) => {
    const seen = new Set<string>();
    for (const a of cliAgents) {
      seen.add(a.id);
      const prior = existingById.get(a.id);
      const row = {
        id: a.id,
        name: a.name,
        identityName: a.identityName ?? null,
        identityEmoji: a.identityEmoji ?? null,
        workspace: a.workspace,
        agentDir: a.agentDir,
        model: a.model ?? null,
        bindings: a.bindings,
        isDefault: a.isDefault,
        systemPrompt: a.systemPrompt ?? null,
        createdAt: prior?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (prior) {
        tx.update(agents).set(row).where(eq(agents.id, a.id)).run();
      } else {
        tx.insert(agents).values(row).run();
      }
    }
    for (const prior of existingRows) {
      if (!seen.has(prior.id)) {
        tx.delete(agents).where(eq(agents.id, prior.id)).run();
      }
    }
  });

  const rows = await db.select().from(agents).orderBy(asc(agents.createdAt));
  return rows.map(rowToAgent);
}
