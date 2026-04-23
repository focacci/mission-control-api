/**
 * One-time import from existing Obsidian markdown files into SQLite.
 * Run with: npm run seed
 */
import { config } from 'dotenv';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { db } from './client.js';
import { goals, initiatives, tasks, taskRequirements, requirementTests, profileSections } from './schema.js';
import { eq } from 'drizzle-orm';

config();

const VAULT_PATH = process.env.VAULT_PATH;
if (!VAULT_PATH) {
  console.error('VAULT_PATH not set in .env');
  process.exit(1);
}

const FOCUS_ICONS: Record<string, string> = {
  sprint: '🔵',
  steady: '🟢',
  simmer: '🟡',
  dormant: '⚪️',
};

// ---------------------------------------------------------------------------
// YAML frontmatter parser
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { meta, body: content };
  }

  let i = 1;
  while (i < lines.length && lines[i]?.trim() !== '---') {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      meta[key] = value;
    }
    i++;
  }

  const body = lines.slice(i + 1).join('\n').trim();
  return { meta, body };
}

// Extract a wikilink target: [[Some Name]] → "Some Name"
function extractWikilink(value: string): string {
  const match = value.match(/\[\[(.+?)\]\]/);
  return match ? match[1] : value;
}

// Extract a named section from markdown body
function extractSection(body: string, heading: string): string {
  const lines = body.split('\n');
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('# ')) {
      if (inSection) break;
      if (line.replace(/^#+\s+/, '').trim() === heading) {
        inSection = true;
        continue;
      }
    } else if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join('\n').trim();
}

// Parse checkboxes from a section: returns [{ description, checked }]
function parseCheckboxes(text: string): Array<{ description: string; completed: boolean }> {
  return text
    .split('\n')
    .filter(l => l.trim().startsWith('- ['))
    .map(l => {
      const checked = l.trim().startsWith('- [x]') || l.trim().startsWith('- [X]');
      const description = l.trim().replace(/^- \[.\]\s*/, '');
      return { description, completed: checked };
    });
}

function now(): string {
  return new Date().toISOString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Import goals
// ---------------------------------------------------------------------------

async function importGoals(): Promise<Map<string, string>> {
  const goalsDir = join(VAULT_PATH!, '🏆 Goals');
  const nameToId = new Map<string, string>();

  if (!existsSync(goalsDir)) {
    console.log(`  Goals dir not found: ${goalsDir}`);
    return nameToId;
  }

  const files = readdirSync(goalsDir).filter(f => f.endsWith('.md'));
  let count = 0;

  for (const file of files) {
    const content = readFileSync(join(goalsDir, file), 'utf8');
    const { meta, body } = parseFrontmatter(content);

    const emoji = meta['emoji'] ?? '🎯';
    const focus = (meta['focus'] ?? 'steady') as 'sprint' | 'steady' | 'simmer' | 'dormant';
    const focusIcon = FOCUS_ICONS[focus] ?? '🟢';
    const timeline = meta['timeline'] ?? null;

    // Derive name from filename (strip .md)
    const displayName = file.replace(/\.md$/, '');
    // Name is displayName without the emoji prefix
    const name = displayName.replace(/^[\p{Emoji}\s]+/u, '').trim() || displayName;

    const story = extractSection(body, 'Story') || null;

    const id = nanoid();
    nameToId.set(displayName, id);
    nameToId.set(name, id);

    try {
      await db.insert(goals).values({
        id,
        emoji,
        name,
        displayName,
        focus,
        focusIcon,
        timeline,
        story,
        sortOrder: 0,
        createdAt: meta['created'] ?? today(),
        updatedAt: now(),
      });
      console.log(`  ✓ Goal: ${displayName}`);
      count++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint')) {
        console.log(`  ~ Goal already exists: ${displayName}`);
      } else {
        console.error(`  ✗ Goal failed: ${displayName} — ${msg}`);
      }
    }
  }

  console.log(`  Imported ${count} goals`);
  return nameToId;
}

// ---------------------------------------------------------------------------
// Import initiatives
// ---------------------------------------------------------------------------

async function importInitiatives(goalNameToId: Map<string, string>): Promise<Map<string, string>> {
  const initDir = join(VAULT_PATH!, '☑️ Initiatives');
  const nameToId = new Map<string, string>();

  if (!existsSync(initDir)) {
    console.log(`  Initiatives dir not found: ${initDir}`);
    return nameToId;
  }

  const files = readdirSync(initDir).filter(f => f.endsWith('.md'));
  let count = 0;

  for (const file of files) {
    const content = readFileSync(join(initDir, file), 'utf8');
    const { meta, body } = parseFrontmatter(content);

    const emoji = meta['emoji'] ?? '📌';
    const status = (meta['status'] ?? 'active') as 'active' | 'backlog' | 'paused' | 'completed';

    const goalWikilink = meta['goal'] ?? '';
    const goalDisplayName = extractWikilink(goalWikilink);
    const goalId = goalNameToId.get(goalDisplayName) ?? null;

    const displayName = file.replace(/\.md$/, '');
    const name = displayName.replace(/^[\p{Emoji}\s]+/u, '').trim() || displayName;
    const mission = extractSection(body, 'Mission') || null;

    const id = nanoid();
    nameToId.set(displayName, id);
    nameToId.set(name, id);

    try {
      await db.insert(initiatives).values({
        id,
        emoji,
        name,
        displayName,
        goalId,
        status,
        mission,
        sortOrder: 0,
        createdAt: meta['created'] ?? today(),
        updatedAt: now(),
      });
      console.log(`  ✓ Initiative: ${displayName}`);
      count++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint')) {
        console.log(`  ~ Initiative already exists: ${displayName}`);
      } else {
        console.error(`  ✗ Initiative failed: ${displayName} — ${msg}`);
      }
    }
  }

  console.log(`  Imported ${count} initiatives`);
  return nameToId;
}

// ---------------------------------------------------------------------------
// Import tasks
// ---------------------------------------------------------------------------

async function importTasks(initiativeNameToId: Map<string, string>): Promise<number> {
  const tasksDir = join(VAULT_PATH!, '🫡 Tasks');
  let count = 0;

  const taskFiles: Array<{ file: string; dir: string; done: boolean }> = [];

  if (existsSync(tasksDir)) {
    for (const f of readdirSync(tasksDir).filter(f => f.endsWith('.md'))) {
      taskFiles.push({ file: f, dir: tasksDir, done: false });
    }
    const doneDir = join(tasksDir, 'done');
    if (existsSync(doneDir)) {
      for (const f of readdirSync(doneDir).filter(f => f.endsWith('.md'))) {
        taskFiles.push({ file: f, dir: doneDir, done: true });
      }
    }
  }

  for (const { file, dir, done } of taskFiles) {
    const content = readFileSync(join(dir, file), 'utf8');
    const { meta, body } = parseFrontmatter(content);

    const rawStatus = meta['status'] ?? (done ? 'done' : 'pending');
    const status = (rawStatus === 'assigned' ? 'pending' : rawStatus) as
      'pending' | 'in-progress' | 'done' | 'blocked' | 'cancelled';

    const initWikilink = meta['initiative'] ?? '';
    const initDisplayName = extractWikilink(initWikilink);
    const initiativeId = initiativeNameToId.get(initDisplayName) ?? null;

    const displayName = file.replace(/\.md$/, '');
    const name = displayName.replace(/^[\p{Emoji}\s]+/u, '').trim() || displayName;

    const objective = extractSection(body, 'Objective') || 'No objective specified';
    const summary = done ? (extractSection(body, 'Summary') || null) : null;
    const completedAt = meta['completed'] && meta['completed'] !== 'null'
      ? meta['completed']
      : (done ? now() : null);

    const id = nanoid();

    try {
      await db.insert(tasks).values({
        id,
        name,
        displayName,
        initiativeId,
        status,
        objective,
        summary,
        sortOrder: 0,
        createdAt: meta['created'] ?? today(),
        updatedAt: now(),
        completedAt,
      });

      // Import requirements
      const reqSection = extractSection(body, 'Requirements');
      const reqIds: string[] = [];
      if (reqSection) {
        const reqs = parseCheckboxes(reqSection);
        for (let i = 0; i < reqs.length; i++) {
          const reqId = nanoid();
          reqIds.push(reqId);
          await db.insert(taskRequirements).values({
            id: reqId,
            taskId: id,
            description: reqs[i].description,
            completed: reqs[i].completed,
            sortOrder: i,
          });
        }
      }

      // The Obsidian vault stores tests at the task level ("Test Plan"),
      // but the refactored schema puts tests under requirements. Attach all
      // Test Plan items to the first requirement as the closest-fit bucket.
      // If the task has no requirements, the tests are skipped.
      const testSection = extractSection(body, 'Test Plan');
      if (testSection && reqIds.length > 0) {
        const tests = parseCheckboxes(testSection);
        const anchorReqId = reqIds[0];
        for (let i = 0; i < tests.length; i++) {
          await db.insert(requirementTests).values({
            id: nanoid(),
            requirementId: anchorReqId,
            description: tests[i].description,
            passed: tests[i].completed,
            sortOrder: i,
          });
        }
      }

      console.log(`  ✓ Task: ${displayName}`);
      count++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint')) {
        console.log(`  ~ Task already exists: ${displayName}`);
      } else {
        console.error(`  ✗ Task failed: ${displayName} — ${msg}`);
      }
    }
  }

  console.log(`  Imported ${count} tasks`);
  return count;
}

// ---------------------------------------------------------------------------
// Profile sections — static defaults mirroring ProfileView.swift
// ---------------------------------------------------------------------------

const PROFILE_SECTION_DEFAULTS: Array<{ id: string; label: string; icon: string }> = [
  { id: 'overview',   label: 'Overview',   icon: 'person.text.rectangle' },
  { id: 'traits',     label: 'Traits',     icon: 'scale.3d' },
  { id: 'habits',     label: 'Habits',     icon: 'repeat' },
  { id: 'places',     label: 'Places',     icon: 'mappin.and.ellipse' },
  { id: 'activities', label: 'Activities', icon: 'figure.run' },
  { id: 'purpose',    label: 'Purpose',    icon: 'target' },
];

async function seedProfileSections(): Promise<number> {
  let count = 0;
  const timestamp = now();
  for (let i = 0; i < PROFILE_SECTION_DEFAULTS.length; i++) {
    const def = PROFILE_SECTION_DEFAULTS[i];
    const existing = await db
      .select({ id: profileSections.id })
      .from(profileSections)
      .where(eq(profileSections.id, def.id));
    if (existing.length > 0) {
      console.log(`  ~ Profile section already exists: ${def.id}`);
      continue;
    }
    await db.insert(profileSections).values({
      id: def.id,
      label: def.label,
      icon: def.icon,
      summary: null,
      sortOrder: i,
      updatedAt: timestamp,
    });
    console.log(`  ✓ Profile section: ${def.id}`);
    count++;
  }
  console.log(`  Inserted ${count} profile sections`);
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🌱 Seeding from Obsidian vault...');
  console.log(`   Vault: ${VAULT_PATH}`);
  console.log('');

  console.log('📌 Importing goals...');
  const goalNameToId = await importGoals();

  console.log('');
  console.log('☑️  Importing initiatives...');
  const initNameToId = await importInitiatives(goalNameToId);

  console.log('');
  console.log('🫡 Importing tasks...');
  await importTasks(initNameToId);

  console.log('');
  console.log('👤 Seeding profile sections...');
  await seedProfileSections();

  console.log('');
  console.log('✅ Seed complete.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
