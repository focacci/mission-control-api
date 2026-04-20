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
    isDefault: false,
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
 * Recovery path for when a DB-tracked openclaw agent has gone missing from the
 * CLI (e.g. the user deleted it directly via `openclaw agents delete`). For
 * each DB row, if the matching openclaw agent is missing, re-create it so
 * chat/bindings keep working. External openclaw agents (not in the DB) are
 * intentionally ignored — Intella only tracks agents it created.
 */
export async function repairAgents(): Promise<OpenclawAgent[]> {
  const cliAgents = await readCliAgents();
  const cliById = new Map(cliAgents.map((a) => [a.id, a]));

  const rows = await db.select().from(agents);
  for (const row of rows) {
    if (cliById.has(row.id)) continue;
    await mkdir(row.workspace, { recursive: true });
    if (row.systemPrompt) {
      await writeSystemPrompt(row.workspace, row.systemPrompt);
    }
    const args = ['agents', 'add', row.id, '--workspace', row.workspace];
    if (row.model) args.push('--model', row.model);
    args.push('--non-interactive', '--json');
    await runOpenclaw(args);
  }

  const finalRows = await db.select().from(agents).orderBy(asc(agents.createdAt));
  return finalRows.map(rowToAgent);
}
