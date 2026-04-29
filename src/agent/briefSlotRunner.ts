import { finalizeBrief, upsertStubBrief } from '../services/briefs.service.js';
import { doneSlot } from '../services/schedule.service.js';
import type { ScheduleSlotRow } from '../services/schedule.service.js';
import type { BriefKind } from '../types/index.types.js';
import { BRIEF_REVEAL_TIMES } from '../types/index.types.js';

const TIME_TO_KIND: Record<string, BriefKind> = {
  [BRIEF_REVEAL_TIMES.morning]: 'morning',
  [BRIEF_REVEAL_TIMES.afternoon]: 'afternoon',
  [BRIEF_REVEAL_TIMES.evening]: 'evening',
};

/**
 * Drive a single due brief slot. Looks up (or stubs) the brief for
 * `(slot.date, kind)` derived from `slot.time`, runs synthesis via
 * {@link finalizeBrief}, and marks the slot done. Never throws — synthesis
 * failures are absorbed by `finalizeBrief` (which falls back to a
 * deterministic summary and tags `references.synthesisFailed`).
 */
export async function runDueBriefSlot(slot: ScheduleSlotRow): Promise<void> {
  const kind = TIME_TO_KIND[slot.time];
  if (!kind) {
    console.warn(`[briefSlotRunner] slot ${slot.id} time=${slot.time} not a brief reveal time`);
    try {
      await doneSlot(slot.id, {});
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    const brief = await upsertStubBrief(slot.date, kind);
    await finalizeBrief(brief.id);
  } catch (err) {
    console.warn(
      `[briefSlotRunner] finalize failed for slot ${slot.id} (${slot.date} ${kind}): ${String(err)}`,
    );
  }

  try {
    await doneSlot(slot.id, {});
  } catch (err) {
    console.warn(`[briefSlotRunner] doneSlot failed for ${slot.id}: ${String(err)}`);
  }
}
