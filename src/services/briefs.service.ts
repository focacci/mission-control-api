import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/client.js';
import { briefs } from '../db/schema.js';
import { synthesizeBriefSummary } from '../agent/briefSynthesizer.js';
import { getDailyRhythm } from './profile.service.js';
import {
  AppError,
  addDaysISO,
  now,
  notFound,
  BRIEF_REVEAL_TIMES,
  BriefBodySchema,
  BriefEvidenceItemSchema,
  BriefReferencesSchema,
  EMPTY_BRIEF_BODY,
  EMPTY_BRIEF_REFERENCES,
  type BriefBody,
  type BriefEvidenceItem,
  type BriefKind,
  type BriefReferences,
  type GenerateBriefInput,
  type ListBriefsQuery,
  type UpdateBriefInput,
} from '../types/index.types.js';

const KIND_ORDER_EXPR = sql<number>`CASE
  WHEN ${briefs.kind} = 'morning' THEN 0
  WHEN ${briefs.kind} = 'afternoon' THEN 1
  WHEN ${briefs.kind} = 'evening' THEN 2
  ELSE 3
END`;

export async function listBriefs(opts: ListBriefsQuery) {
  if (opts.from > opts.to) {
    throw new AppError(400, `from (${opts.from}) must be <= to (${opts.to})`);
  }
  return db
    .select()
    .from(briefs)
    .where(and(gte(briefs.date, opts.from), lte(briefs.date, opts.to)))
    .orderBy(desc(briefs.date), asc(KIND_ORDER_EXPR));
}

export async function getBrief(id: string) {
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!brief) throw notFound('Brief', id);
  return brief;
}

export async function getBriefsByDate(date: string) {
  const rows = await db.select().from(briefs).where(eq(briefs.date, date));
  const byKind = { morning: null, afternoon: null, evening: null } as Record<
    BriefKind,
    typeof rows[number] | null
  >;
  for (const row of rows) byKind[row.kind] = row;
  return { date, ...byKind };
}

/**
 * Manual regenerate path. Re-runs LLM synthesis on the accumulated evidence
 * and freezes the brief. Idempotent on already-revealed briefs unless
 * `force: true` is passed (re-runs synthesis on a `ready`/`acknowledged`
 * brief — used by the iOS "regenerate" debug affordance).
 */
export async function generateBrief(input: GenerateBriefInput) {
  let id = input.briefId;
  if (!id) {
    if (!input.date || !input.kind) {
      throw new AppError(400, 'generateBrief requires briefId, or both date and kind');
    }
    const [row] = await db
      .select()
      .from(briefs)
      .where(and(eq(briefs.date, input.date), eq(briefs.kind, input.kind)));
    if (!row) throw notFound('Brief', `${input.date}/${input.kind}`);
    id = row.id;
  }
  return finalizeBrief(id, { force: input.force === true });
}

export async function updateBrief(id: string, input: UpdateBriefInput) {
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!existing) throw notFound('Brief', id);

  const updates: Partial<typeof existing> = { updatedAt: now() };
  if ('title' in input) updates.title = input.title ?? null;
  if ('body' in input) updates.body = input.body ?? null;
  if ('references' in input) updates.references = input.references ?? null;
  if (input.status !== undefined) updates.status = input.status;

  await db.update(briefs).set(updates).where(eq(briefs.id, id));
  const [updated] = await db.select().from(briefs).where(eq(briefs.id, id));
  return updated;
}

export async function deleteBrief(id: string) {
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, id));
  if (!existing) throw notFound('Brief', id);
  await db.delete(briefs).where(eq(briefs.id, id));
}

// ---------------------------------------------------------------------------
// Window math + stub seeding
// ---------------------------------------------------------------------------

/**
 * Compute the (windowStart, windowEnd, revealAt) for a given (date, kind).
 *
 * Reveal times come from `BRIEF_REVEAL_TIMES`. Windows are:
 *   - morning   : prev evening reveal (19:00 prev day) → 07:00 today
 *   - afternoon : 07:00 today → 12:30 today
 *   - evening   : 12:30 today → 19:00 today
 *
 * Per BRIEFINGS_PLAN §10 Q3, the rhythm is read at stub-creation time and
 * then frozen on the row, so mid-day rhythm edits don't reshape today's
 * windows.
 */
export async function computeBriefWindow(
  date: string,
  kind: BriefKind,
): Promise<{ windowStart: string; windowEnd: string; revealAt: string }> {
  // Pull rhythm so a future change to phase boundaries can shift these. Today
  // we only use BRIEF_REVEAL_TIMES, but reading the rhythm makes the
  // dependency explicit and warms the cache.
  await getDailyRhythm();

  const reveal = BRIEF_REVEAL_TIMES[kind];
  const revealAt = `${date}T${reveal}:00`;

  let windowStart: string;
  let windowEnd: string;

  if (kind === 'morning') {
    const prevDate = addDaysISO(date, -1);
    windowStart = `${prevDate}T${BRIEF_REVEAL_TIMES.evening}:00`;
    windowEnd = revealAt;
  } else if (kind === 'afternoon') {
    windowStart = `${date}T${BRIEF_REVEAL_TIMES.morning}:00`;
    windowEnd = revealAt;
  } else {
    windowStart = `${date}T${BRIEF_REVEAL_TIMES.afternoon}:00`;
    windowEnd = revealAt;
  }

  return { windowStart, windowEnd, revealAt };
}

/**
 * Insert a brief stub (or return the existing row). Stubs always get a
 * frozen `revealAt`/`windowStart`/`windowEnd` based on the user's rhythm at
 * the moment of creation.
 */
export async function upsertStubBrief(date: string, kind: BriefKind) {
  const [existing] = await db
    .select()
    .from(briefs)
    .where(and(eq(briefs.date, date), eq(briefs.kind, kind)));
  if (existing) {
    if (!existing.revealAt || !existing.windowStart || !existing.windowEnd) {
      const window = await computeBriefWindow(date, kind);
      await db
        .update(briefs)
        .set({
          revealAt: window.revealAt,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          updatedAt: now(),
        })
        .where(eq(briefs.id, existing.id));
      return { ...existing, ...window };
    }
    return existing;
  }

  const window = await computeBriefWindow(date, kind);
  const timestamp = now();
  const row = {
    id: nanoid(),
    date,
    kind,
    status: 'pending' as const,
    title: null,
    body: null,
    references: null,
    invocationId: null,
    generatedAt: null,
    revealAt: window.revealAt,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    acknowledgedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.insert(briefs).values(row);
  return row;
}

/**
 * Find the brief whose window covers `instant` (an ISO timestamp). Used by
 * evidence-append hooks that don't know which brief their event belongs to.
 *
 * Returns null if no matching brief exists; caller can decide whether to
 * lazily stub one.
 */
export async function findBriefForInstant(instant: string) {
  const rows = await db
    .select()
    .from(briefs)
    .where(
      and(
        lte(briefs.windowStart, instant),
        gte(briefs.windowEnd, instant),
      ),
    );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Body / references parsing helpers
// ---------------------------------------------------------------------------

function parseBody(raw: string | null): BriefBody {
  if (!raw) return cloneEmptyBody();
  try {
    return BriefBodySchema.parse(JSON.parse(raw));
  } catch {
    // Legacy / hand-authored freeform text — surface it as the summary so
    // the iOS structured renderer still has something to show.
    return { ...cloneEmptyBody(), summary: raw };
  }
}

function parseReferences(raw: string | null): BriefReferences {
  if (!raw) return cloneEmptyReferences();
  try {
    return BriefReferencesSchema.parse(JSON.parse(raw));
  } catch {
    return cloneEmptyReferences();
  }
}

function cloneEmptyBody(): BriefBody {
  return JSON.parse(JSON.stringify(EMPTY_BRIEF_BODY)) as BriefBody;
}

function cloneEmptyReferences(): BriefReferences {
  return JSON.parse(JSON.stringify(EMPTY_BRIEF_REFERENCES)) as BriefReferences;
}

function pushUnique(arr: string[], v: string | null | undefined) {
  if (!v) return;
  if (!arr.includes(v)) arr.push(v);
}

function applyEvidenceToBody(body: BriefBody, item: BriefEvidenceItem): boolean {
  switch (item.kind) {
    case 'agent_work': {
      const list = body.sections.agentWork;
      const existing = list.findIndex(x => x.agentOutputId === item.agentOutputId);
      if (existing >= 0) {
        list[existing] = item;
        return false;
      }
      list.push(item);
      return true;
    }
    case 'open_question': {
      const list = body.sections.openQuestions;
      if (list.some(x => x.questionId === item.questionId)) return false;
      list.push(item);
      return true;
    }
    case 'accomplishment': {
      const list = body.sections.userAccomplishments;
      if (list.some(x => x.source === item.source && x.refId === item.refId)) return false;
      list.push(item);
      return true;
    }
    case 'profile_gap': {
      const list = body.sections.profileGaps;
      if (
        list.some(
          x =>
            x.profileSectionId === item.profileSectionId &&
            (x.profileEntryId ?? null) === (item.profileEntryId ?? null),
        )
      )
        return false;
      list.push(item);
      return true;
    }
    case 'world_signal': {
      const list = body.sections.worldSignal;
      if (list.some(x => x.provider === item.provider && x.headline === item.headline))
        return false;
      list.push(item);
      return true;
    }
  }
}

function applyEvidenceToReferences(refs: BriefReferences, item: BriefEvidenceItem) {
  switch (item.kind) {
    case 'agent_work':
      pushUnique(refs.agentOutputIds, item.agentOutputId);
      break;
    case 'open_question':
      pushUnique(refs.agentOutputIds, item.agentOutputId ?? undefined);
      pushUnique(refs.invocationIds, item.invocationId ?? undefined);
      pushUnique(refs.chatMessageIds, item.chatMessageId ?? undefined);
      break;
    case 'accomplishment':
      if (item.source === 'task') pushUnique(refs.taskIds, item.refId);
      else if (item.source === 'requirement') pushUnique(refs.requirementIds, item.refId);
      else if (item.source === 'slot') pushUnique(refs.slotIds, item.refId);
      else if (item.source === 'chat') pushUnique(refs.chatMessageIds, item.refId);
      break;
    case 'profile_gap':
      pushUnique(refs.profileSectionIds, item.profileSectionId);
      pushUnique(refs.profileEntryIds, item.profileEntryId ?? undefined);
      break;
    case 'world_signal':
      pushUnique(refs.urls, item.url ?? undefined);
      break;
  }
}

// ---------------------------------------------------------------------------
// appendBriefEvidence
// ---------------------------------------------------------------------------

/**
 * Cheap-path evidence append. Writes a typed item directly into the brief
 * body's sections array. No LLM call. Idempotent on (kind, id) within each
 * section. Auto-transitions `pending → drafting`.
 */
export async function appendBriefEvidence(briefId: string, rawItem: unknown) {
  const item = BriefEvidenceItemSchema.parse(rawItem);
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  if (!existing) throw notFound('Brief', briefId);

  // Don't mutate revealed briefs — once frozen, evidence appends are a no-op
  // and we surface a 409 so the caller can decide whether to escalate.
  if (existing.status === 'ready' || existing.status === 'acknowledged') {
    throw new AppError(409, `Brief ${briefId} is already ${existing.status} — cannot append`);
  }

  const body = parseBody(existing.body);
  const refs = parseReferences(existing.references);

  applyEvidenceToBody(body, item);
  applyEvidenceToReferences(refs, item);

  const nextStatus =
    existing.status === 'pending' || existing.status === 'error' ? 'drafting' : existing.status;

  await db
    .update(briefs)
    .set({
      body: JSON.stringify(body),
      references: JSON.stringify(refs),
      status: nextStatus,
      updatedAt: now(),
    })
    .where(eq(briefs.id, briefId));

  const [updated] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  return updated;
}

/**
 * Resolve the live brief whose window covers `occurredAt` (defaults to now)
 * and append the evidence item. If no brief exists for that instant we lazy-
 * stub one. Returns null when the timestamp doesn't fall in any current
 * day's three reveal windows (e.g. far-past backfill).
 */
export async function appendEvidenceForInstant(
  occurredAt: string,
  item: BriefEvidenceItem,
): Promise<{ briefId: string } | null> {
  let row = await findBriefForInstant(occurredAt);
  if (!row) {
    const date = occurredAt.slice(0, 10);
    const time = occurredAt.slice(11, 16);
    let kind: BriefKind | null = null;
    // Map timestamp → kind based on reveal table.
    if (time < BRIEF_REVEAL_TIMES.morning) kind = 'morning';
    else if (time < BRIEF_REVEAL_TIMES.afternoon) kind = 'afternoon';
    else if (time < BRIEF_REVEAL_TIMES.evening) kind = 'evening';
    if (!kind) {
      // post-19:00 → next day's morning brief covers the rest of tonight
      const nextDate = addDaysISO(date, 1);
      const stub = await upsertStubBrief(nextDate, 'morning');
      row = stub as typeof row;
    } else {
      const stub = await upsertStubBrief(date, kind);
      row = stub as typeof row;
    }
  }
  if (!row) return null;
  await appendBriefEvidence(row.id, item);
  return { briefId: row.id };
}

// ---------------------------------------------------------------------------
// finalize / acknowledge
// ---------------------------------------------------------------------------

export interface FinalizeBriefOptions {
  /** Re-run synthesis on an already-revealed brief (manual regenerate path). */
  force?: boolean;
}

/**
 * Freeze a brief and run LLM synthesis on the accumulated evidence. The
 * synthesized text replaces `body.summary`; if synthesis fails or the gateway
 * is unreachable, we fall back to a deterministic count-summary and tag
 * `references.synthesisFailed = true` so the iOS UI can render a banner.
 *
 * Idempotent — calling twice on a `ready`/`acknowledged` brief returns the
 * existing row unchanged unless `force: true` is passed.
 */
export async function finalizeBrief(briefId: string, opts: FinalizeBriefOptions = {}) {
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  if (!existing) throw notFound('Brief', briefId);

  const alreadyRevealed = existing.status === 'ready' || existing.status === 'acknowledged';
  if (alreadyRevealed && !opts.force) {
    return existing;
  }

  const body = parseBody(existing.body);
  const refs = parseReferences(existing.references);
  const fallback = buildFallbackSummary(body);

  const synthesis = await synthesizeBriefSummary({
    briefId,
    kind: existing.kind,
    windowStart: existing.windowStart,
    windowEnd: existing.windowEnd,
    body,
  });

  if (synthesis.summary && synthesis.summary.length > 0) {
    body.summary = synthesis.summary;
    if (refs.synthesisFailed) delete refs.synthesisFailed;
  } else {
    body.summary = body.summary?.trim().length ? body.summary : fallback;
    refs.synthesisFailed = true;
  }

  const timestamp = now();
  await db
    .update(briefs)
    .set({
      body: JSON.stringify(body),
      references: JSON.stringify(refs),
      status: 'ready',
      invocationId: synthesis.invocationId ?? existing.invocationId ?? null,
      generatedAt: existing.generatedAt ?? timestamp,
      updatedAt: timestamp,
    })
    .where(eq(briefs.id, briefId));

  const [updated] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  return updated;
}

/**
 * Lazy finalize: called by the GET path when a brief is past its `revealAt`
 * but still in `drafting`/`pending`. Safe to call on any brief.
 */
export async function maybeLazyFinalize(briefId: string, asOf: string = now()) {
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  if (!existing) return null;
  if (!existing.revealAt) return existing;
  if (asOf < existing.revealAt) return existing;
  if (existing.status === 'ready' || existing.status === 'acknowledged') return existing;
  return finalizeBrief(briefId);
}

export async function acknowledgeBrief(briefId: string) {
  const [existing] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  if (!existing) throw notFound('Brief', briefId);

  // Acknowledge implies finalized — if the user opens a still-drafting brief
  // (e.g. lazy reveal path), finalize first so they see a frozen artifact.
  let row = existing;
  if (existing.status !== 'ready' && existing.status !== 'acknowledged') {
    row = (await finalizeBrief(briefId))!;
  }

  if (row.status === 'acknowledged') return row;

  const timestamp = now();
  await db
    .update(briefs)
    .set({
      status: 'acknowledged',
      acknowledgedAt: row.acknowledgedAt ?? timestamp,
      updatedAt: timestamp,
    })
    .where(eq(briefs.id, briefId));

  const [updated] = await db.select().from(briefs).where(eq(briefs.id, briefId));
  return updated;
}

function buildFallbackSummary(body: BriefBody): string {
  const a = body.sections.agentWork.length;
  const u = body.sections.userAccomplishments.length;
  const q = body.sections.openQuestions.length;
  const parts: string[] = [];
  parts.push(`${a} agent output${a === 1 ? '' : 's'}`);
  parts.push(`${u} accomplishment${u === 1 ? '' : 's'}`);
  if (q > 0) parts.push(`${q} open question${q === 1 ? '' : 's'}`);
  return `${parts.join(', ')} since last brief.`;
}
