import type { TxClient } from '../../db/transaction';
import { childLogger } from '../../core/logger';
import { createAuditEvent, createAccessDeniedEvent, findRecentAccessDenied, type CreateAuditEventInput } from './audit.repository';

const log = childLogger({ module: 'audit' });

/**
 * The only way any code in this system writes an audit row for a mutation. Requires a
 * `tx` client — deliberately no non-transactional overload — making it structurally
 * impossible to record an event for a state change that then rolls back, or to change
 * state without recording it (build-plan.md, Module 2/8).
 */
export function record(tx: TxClient, input: CreateAuditEventInput) {
  return createAuditEvent(input, tx);
}

const DENIAL_DEDUPE_WINDOW_MS = 60_000;

// Test-only bookkeeping (see flushPendingDenials below) — production callers never
// touch this and always treat recordDenial as pure fire-and-forget.
const pendingDenials = new Set<Promise<void>>();

/**
 * build-plan.md finding S3: a refusal is not a mutation, so it gets no transaction and
 * no place to be atomic WITH — recordDenial is fire-and-forget (never awaited by the
 * caller, never throws) so a failure of this insert can never turn a 403 into a 500,
 * and deduped per (actorId, incidentId) over a short window so a clearance-1 user
 * looping IDs cannot use it for unbounded write amplification.
 */
export function recordDenial(input: {
  incidentId: string;
  actorId: string;
  reason: string;
  clearanceLevel: number;
}): void {
  const now = new Date();
  const promise = recordDenialAsync(input, now).catch((err: unknown) => {
    log.error({ err, ...input }, 'failed to record ACCESS_DENIED audit event');
  });
  pendingDenials.add(promise);
  void promise.finally(() => pendingDenials.delete(promise));
}

/**
 * Test-only: waits for every in-flight best-effort denial write to settle. Without
 * this, a test's TRUNCATE can delete an incident a still-pending recordDenial from the
 * PREVIOUS test hasn't finished writing against yet, producing a real (harmless, since
 * it's caught above) but noisy foreign-key error. Call it from truncateAll — never
 * from application code, which must keep treating recordDenial as fire-and-forget.
 */
export async function flushPendingDenials(): Promise<void> {
  await Promise.all(pendingDenials);
}

async function recordDenialAsync(
  input: { incidentId: string; actorId: string; reason: string; clearanceLevel: number },
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - DENIAL_DEDUPE_WINDOW_MS);
  const recent = await findRecentAccessDenied(input.actorId, input.incidentId, since);
  if (recent) return;
  await createAccessDeniedEvent({ ...input, occurredAt: now });
}
