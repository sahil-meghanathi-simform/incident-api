import type { TxClient } from './transaction';

/**
 * pg_try_advisory_xact_lock is transaction-scoped: it releases automatically on
 * commit/rollback/crash, and is visible database-wide (so it genuinely serialises two
 * API instances). It is a work-avoidance mechanism, not a correctness mechanism — the
 * job's actual idempotency comes from unique constraints reached via ON CONFLICT DO
 * NOTHING (see jobs/escalation.job.ts and docs/escalation.md).
 */
export async function tryAdvisoryXactLock(tx: TxClient, key: bigint): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked
  `;
  return rows[0]?.locked ?? false;
}
