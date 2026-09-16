import { env } from '../config/env';
import { systemClock } from '../core/time';
import { childLogger } from '../core/logger';
import { runEscalationJob } from './escalation.job';

const logger = childLogger({ module: 'scheduler' });

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let inFlight: Promise<void> | null = null;

/**
 * setInterval tick loop with an in-process overlap guard. The tick's promise chain
 * MUST end in .catch().finally() — an unhandled rejection from a setInterval callback
 * is fatal on Node 22 by default, so a single failed run (even a legitimately handled
 * SKIPPED_LOCKED path throwing for an unrelated reason) would otherwise kill the whole
 * API container, and a missing `finally` would wedge `running = true` forever
 * (build-plan.md, smaller items list).
 */
export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    inFlight = runEscalationJob({ clock: systemClock, logger })
      .then((result) => {
        logger.info(result, 'escalation tick complete');
      })
      .catch((err) => {
        logger.error({ err }, 'escalation tick failed');
      })
      .finally(() => {
        running = false;
        inFlight = null;
      });
  }, env.ESCALATION_TICK_MS);
  logger.info({ intervalMs: env.ESCALATION_TICK_MS }, 'escalation scheduler started');
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Awaited by graceful shutdown so an in-flight run is not abandoned mid-batch. */
export async function drainScheduler(): Promise<void> {
  if (inFlight) await inFlight;
}
