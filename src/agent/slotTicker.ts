import { claimSlotForRun, findDueSlots } from '../services/schedule.service.js';
import { runDueSlot } from './slotRunner.js';

export interface StartSlotTickerOptions {
  intervalMs?: number;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

const DEFAULT_INTERVAL_MS = Number(process.env.SLOT_TICKER_INTERVAL_MS ?? 60_000);

/**
 * Periodic in-process scheduler for due slots. At most one tick runs at a
 * time (re-entry is dropped). Within a tick, slots fire sequentially in
 * `datetime ASC` order. Returns a stop function that disables the timer; an
 * in-flight tick is allowed to drain.
 */
export function startSlotTicker(opts: StartSlotTickerOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const log = opts.logger ?? console;

  let isRunning = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || isRunning) return;
    isRunning = true;
    try {
      const due = await findDueSlots(new Date().toISOString());
      for (const slot of due) {
        if (stopped) break;
        const claimed = claimSlotForRun(slot.id);
        if (!claimed) continue;
        try {
          await runDueSlot(claimed);
        } catch (err) {
          log.warn(`[slotTicker] runDueSlot threw for slot ${claimed.id}: ${String(err)}`);
        }
      }
    } catch (err) {
      log.error(`[slotTicker] tick failed: ${String(err)}`);
    } finally {
      isRunning = false;
    }
  };

  log.info(`[slotTicker] started — interval ${intervalMs}ms`);
  const handle = setInterval(() => { void tick(); }, intervalMs);
  // Allow the process to exit naturally even if the timer is alive.
  if (typeof handle.unref === 'function') handle.unref();

  // Fire one tick immediately so cold-boot doesn't wait a full interval.
  void tick();

  return () => {
    stopped = true;
    clearInterval(handle);
    log.info('[slotTicker] stopped');
  };
}
