import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { profileSections, profileEntries } from '../db/schema.js';
import {
  now,
  notFound,
  DAILY_RHYTHM_SECTION_ID,
  DAILY_RHYTHM_PHASES,
  DEFAULT_DAILY_RHYTHM,
  DailyRhythmEntryDetailSchema,
  type DailyRhythmPhase,
  type DailyRhythmEntryDetail,
  type UpdateProfileSectionInput,
  type AddProfileEntryInput,
  type UpdateProfileEntryInput,
} from '../types/index.types.js';

export async function getProfile() {
  const sections = await db
    .select()
    .from(profileSections)
    .orderBy(asc(profileSections.sortOrder));

  const entries = await db
    .select()
    .from(profileEntries)
    .orderBy(asc(profileEntries.sortOrder), asc(profileEntries.createdAt));

  const bySection = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = bySection.get(e.sectionId) ?? [];
    arr.push(e);
    bySection.set(e.sectionId, arr);
  }

  return {
    sections: sections.map(s => ({ ...s, entries: bySection.get(s.id) ?? [] })),
  };
}

export async function getSection(sectionId: string) {
  const [section] = await db
    .select()
    .from(profileSections)
    .where(eq(profileSections.id, sectionId));
  if (!section) throw notFound('ProfileSection', sectionId);

  const entries = await db
    .select()
    .from(profileEntries)
    .where(eq(profileEntries.sectionId, sectionId))
    .orderBy(asc(profileEntries.sortOrder), asc(profileEntries.createdAt));

  return { ...section, entries };
}

export async function updateSection(sectionId: string, input: UpdateProfileSectionInput) {
  const [existing] = await db
    .select()
    .from(profileSections)
    .where(eq(profileSections.id, sectionId));
  if (!existing) throw notFound('ProfileSection', sectionId);

  const updates: Partial<typeof existing> = { updatedAt: now() };
  if ('summary' in input) updates.summary = input.summary ?? null;
  if ('sortOrder' in input && input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  await db.update(profileSections).set(updates).where(eq(profileSections.id, sectionId));

  const [updated] = await db
    .select()
    .from(profileSections)
    .where(eq(profileSections.id, sectionId));
  return updated;
}

export async function addEntry(sectionId: string, input: AddProfileEntryInput) {
  const [section] = await db
    .select()
    .from(profileSections)
    .where(eq(profileSections.id, sectionId));
  if (!section) throw notFound('ProfileSection', sectionId);

  const entry = {
    id: nanoid(),
    sectionId,
    label: input.label,
    detail: input.detail ?? null,
    confidence: input.confidence ?? 'observed',
    source: input.source ?? null,
    sortOrder: input.sortOrder ?? 0,
    createdAt: now(),
    updatedAt: now(),
  };

  await db.insert(profileEntries).values(entry);
  await db
    .update(profileSections)
    .set({ updatedAt: now() })
    .where(eq(profileSections.id, sectionId));

  return entry;
}

export async function updateEntry(entryId: string, input: UpdateProfileEntryInput) {
  const [existing] = await db
    .select()
    .from(profileEntries)
    .where(eq(profileEntries.id, entryId));
  if (!existing) throw notFound('ProfileEntry', entryId);

  const updates: Partial<typeof existing> = { updatedAt: now() };
  if (input.label !== undefined) updates.label = input.label;
  if ('detail' in input) updates.detail = input.detail ?? null;
  if (input.confidence !== undefined) updates.confidence = input.confidence;
  if ('source' in input) updates.source = input.source ?? null;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  await db.update(profileEntries).set(updates).where(eq(profileEntries.id, entryId));
  await db
    .update(profileSections)
    .set({ updatedAt: now() })
    .where(eq(profileSections.id, existing.sectionId));

  const [updated] = await db
    .select()
    .from(profileEntries)
    .where(eq(profileEntries.id, entryId));
  return updated;
}

// ---------------------------------------------------------------------------
// Daily Rhythm — well-known profile section that drives Briefings windows.
// ---------------------------------------------------------------------------

const PHASE_LABEL: Record<DailyRhythmPhase, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  overnight: 'Overnight',
};

const PHASE_LABEL_TO_PHASE: Record<string, DailyRhythmPhase> = Object.fromEntries(
  DAILY_RHYTHM_PHASES.map(p => [PHASE_LABEL[p], p]),
) as Record<string, DailyRhythmPhase>;

/**
 * Idempotently insert the `daily_rhythm` section + four phase entries with
 * the defaults from {@link DEFAULT_DAILY_RHYTHM}. Existing rows are left
 * untouched so user edits survive re-seeding.
 */
export async function ensureDailyRhythmSeeded() {
  const timestamp = now();

  const [existingSection] = await db
    .select()
    .from(profileSections)
    .where(eq(profileSections.id, DAILY_RHYTHM_SECTION_ID));

  if (!existingSection) {
    await db.insert(profileSections).values({
      id: DAILY_RHYTHM_SECTION_ID,
      label: 'Daily Rhythm',
      icon: 'clock',
      summary: null,
      sortOrder: 100,
      updatedAt: timestamp,
    });
  }

  for (let i = 0; i < DAILY_RHYTHM_PHASES.length; i++) {
    const phase = DAILY_RHYTHM_PHASES[i];
    const label = PHASE_LABEL[phase];
    const [existingEntry] = await db
      .select()
      .from(profileEntries)
      .where(
        and(
          eq(profileEntries.sectionId, DAILY_RHYTHM_SECTION_ID),
          eq(profileEntries.label, label),
        ),
      );
    if (existingEntry) continue;
    await db.insert(profileEntries).values({
      id: nanoid(),
      sectionId: DAILY_RHYTHM_SECTION_ID,
      label,
      detail: JSON.stringify(DEFAULT_DAILY_RHYTHM[phase]),
      confidence: 'stated',
      source: 'seed',
      sortOrder: i,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

/**
 * Read the user's daily rhythm. Falls back to {@link DEFAULT_DAILY_RHYTHM}
 * for any phase that is missing or has malformed JSON, so callers always get
 * a complete map.
 */
export async function getDailyRhythm(): Promise<Record<DailyRhythmPhase, DailyRhythmEntryDetail>> {
  const entries = await db
    .select()
    .from(profileEntries)
    .where(eq(profileEntries.sectionId, DAILY_RHYTHM_SECTION_ID));

  const rhythm: Record<DailyRhythmPhase, DailyRhythmEntryDetail> = {
    ...DEFAULT_DAILY_RHYTHM,
  };

  for (const entry of entries) {
    const phase = PHASE_LABEL_TO_PHASE[entry.label];
    if (!phase || !entry.detail) continue;
    try {
      const parsed = DailyRhythmEntryDetailSchema.parse(JSON.parse(entry.detail));
      rhythm[phase] = parsed;
    } catch {
      // leave default in place
    }
  }

  return rhythm;
}

export async function deleteEntry(entryId: string) {
  const [existing] = await db
    .select()
    .from(profileEntries)
    .where(eq(profileEntries.id, entryId));
  if (!existing) throw notFound('ProfileEntry', entryId);

  await db.delete(profileEntries).where(eq(profileEntries.id, entryId));
  await db
    .update(profileSections)
    .set({ updatedAt: now() })
    .where(eq(profileSections.id, existing.sectionId));
}
