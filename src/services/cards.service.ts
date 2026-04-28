import { asc, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  agentAssignments,
  goals,
  initiatives,
  scheduleSlots,
  slotOutputs,
  tasks,
} from '../db/schema.js';
import { CARD_KINDS, type CardKind } from '../types/index.types.js';

export interface CardRef {
  cardType: CardKind;
  entityId: string;
}

export type HydratedCards = {
  [K in CardKind]?: unknown[];
};

/**
 * Bulk-hydrate card references emitted by `render_card` parts. iOS posts the
 * tuples found in a turn's `parts[]`; the response groups full rows by kind
 * so the renderer can build a `(kind, id) → row` cache in one round-trip.
 *
 * Unknown ids are silently dropped — the caller already has a fallback render.
 * Each kind's bucket only appears when at least one id was requested.
 */
export async function hydrateCards(refs: CardRef[]): Promise<HydratedCards> {
  if (refs.length === 0) return {};

  const byKind = new Map<CardKind, Set<string>>();
  for (const ref of refs) {
    if (!CARD_KINDS.includes(ref.cardType)) continue;
    if (!ref.entityId) continue;
    const set = byKind.get(ref.cardType) ?? new Set<string>();
    set.add(ref.entityId);
    byKind.set(ref.cardType, set);
  }

  const out: HydratedCards = {};
  await Promise.all(
    Array.from(byKind.entries()).map(async ([kind, ids]) => {
      out[kind] = await loadKind(kind, Array.from(ids));
    }),
  );
  return out;
}

async function loadKind(kind: CardKind, ids: string[]): Promise<unknown[]> {
  if (ids.length === 0) return [];
  switch (kind) {
    case 'task':
      return db.select().from(tasks).where(inArray(tasks.id, ids));
    case 'goal':
      return db.select().from(goals).where(inArray(goals.id, ids));
    case 'initiative':
      return db.select().from(initiatives).where(inArray(initiatives.id, ids));
    case 'agent_assignment':
      return db
        .select()
        .from(agentAssignments)
        .where(inArray(agentAssignments.id, ids));
    case 'slot':
      return loadSlots(ids);
    case 'schedule_day':
      return loadScheduleDays(ids);
  }
}

async function loadSlots(ids: string[]) {
  const slots = await db
    .select()
    .from(scheduleSlots)
    .where(inArray(scheduleSlots.id, ids))
    .orderBy(asc(scheduleSlots.datetime));

  if (slots.length === 0) return [];

  const outputs = await db
    .select()
    .from(slotOutputs)
    .where(inArray(slotOutputs.slotId, slots.map(s => s.id)))
    .orderBy(asc(slotOutputs.createdAt));
  const outputsBySlot = new Map<string, typeof outputs>();
  for (const o of outputs) {
    const arr = outputsBySlot.get(o.slotId) ?? [];
    arr.push(o);
    outputsBySlot.set(o.slotId, arr);
  }

  const aaIds = slots
    .map(s => s.agentAssignmentId)
    .filter((id): id is string => id != null);
  const aaRows = aaIds.length
    ? await db
        .select()
        .from(agentAssignments)
        .where(inArray(agentAssignments.id, aaIds))
    : [];
  const aaMap = new Map(aaRows.map(a => [a.id, a]));

  return slots.map(s => ({
    ...s,
    agentAssignment: s.agentAssignmentId ? aaMap.get(s.agentAssignmentId) ?? null : null,
    outputs: outputsBySlot.get(s.id) ?? [],
  }));
}

/**
 * `schedule_day` cards key on an ISO date string (`YYYY-MM-DD`). Hydration
 * returns one bucket per requested date with its slots, sorted chronologically.
 */
async function loadScheduleDays(dates: string[]) {
  const slots = await db
    .select()
    .from(scheduleSlots)
    .where(inArray(scheduleSlots.date, dates))
    .orderBy(asc(scheduleSlots.datetime));

  const byDate = new Map<string, typeof slots>();
  for (const s of slots) {
    const arr = byDate.get(s.date) ?? [];
    arr.push(s);
    byDate.set(s.date, arr);
  }

  return dates.map(date => ({
    date,
    slots: byDate.get(date) ?? [],
  }));
}

