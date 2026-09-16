import type { Clock } from '../core/time';
import type { Logger } from '../core/logger';
import { newId } from '../core/ids';
import { prisma } from '../db/prisma';
import type { TxClient } from '../db/transaction';
import { withTransaction } from '../db/transaction';
import { tryAdvisoryXactLock } from '../db/advisoryLock';
import { ESCALATION_BATCH_SIZE, ESCALATION_LEASE_MS, ESCALATION_LOCK_KEY } from '../config/constants';
import { activeTiers, type Tier } from '../modules/escalation/tiers.repository';
import { SEVERITY_RANK } from '../config/constants';
import { jobRunRepository } from './jobRun.repository';
import type { Severity } from '../contracts/enums';
import type { Prisma } from '@prisma/client';

export interface EscalationCandidate {
  id: string;
  severity: Severity;
  highSeveritySince: Date;
  escalationCycle: number;
  currentEscalationLevel: number;
}

export interface DueTier {
  level: number;
  thresholdMinutes: number;
}

/**
 * Pure, no I/O, exhaustively unit-tested (tests/unit/tiersDueFor.spec.ts). Returns every
 * tier for the incident's severity whose threshold has elapsed AND whose level exceeds
 * currentEscalationLevel, ASCENDING by level. Ascending order is what lets a single
 * batch transaction admit levels 1, 2 and 3 in sequence for an incident nobody looked at
 * for three days (build-plan.md B2 test).
 */
export function tiersDueFor(incident: EscalationCandidate, tiers: Tier[], now: Date): DueTier[] {
  const elapsedMinutes = (now.getTime() - incident.highSeveritySince.getTime()) / 60_000;
  return tiers
    .filter((t) => t.severity === incident.severity)
    .filter((t) => t.level > incident.currentEscalationLevel)
    .filter((t) => elapsedMinutes >= t.thresholdMinutes)
    .sort((a, b) => a.level - b.level)
    .map((t) => ({ level: t.level, thresholdMinutes: t.thresholdMinutes }));
}

interface BatchRow {
  id: string;
  severity: Severity;
  highSeveritySince: Date | null;
  escalationCycle: number;
  currentEscalationLevel: number;
}

export interface EscalationRunResult {
  outcome: 'COMPLETED' | 'SKIPPED_LOCKED' | 'FAILED';
  scanned: number;
  escalated: number;
  notified: number;
}

interface Deps {
  clock: Clock;
  logger: Logger;
}

async function recipientsFor(severity: Severity): Promise<{ id: string }[]> {
  return prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['TRIAGE_MANAGER', 'ADMIN'] },
      clearanceLevel: { gte: SEVERITY_RANK[severity] },
    },
    select: { id: true },
  });
}

async function claimLease(clock: Clock): Promise<string | null> {
  const runId = newId();
  const claimed = await withTransaction(async (tx) => {
    const locked = await tryAdvisoryXactLock(tx, ESCALATION_LOCK_KEY);
    if (!locked) return false;
    const now = clock.now();
    const rows = await tx.$executeRaw`
      UPDATE "JobLease"
         SET "ownerRunId" = ${runId}, "heldUntil" = ${new Date(now.getTime() + ESCALATION_LEASE_MS)}
       WHERE "jobName" = 'escalation'
         AND ("heldUntil" IS NULL OR "heldUntil" <= ${now})
    `;
    return rows === 1;
  });
  return claimed ? runId : null;
}

async function renewLease(runId: string, clock: Clock): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "JobLease" SET "heldUntil" = ${new Date(clock.now().getTime() + ESCALATION_LEASE_MS)}
     WHERE "jobName" = 'escalation' AND "ownerRunId" = ${runId}
  `;
}

async function releaseLease(runId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "JobLease" SET "ownerRunId" = NULL, "heldUntil" = NULL
     WHERE "jobName" = 'escalation' AND "ownerRunId" = ${runId}
  `;
}

/**
 * Escalates every unacknowledged HIGH/CRITICAL incident whose band-entry clock has
 * crossed a tier threshold. Correctness properties and why (build-plan.md B2/B3/S2/S5):
 *
 *  - Exactly-once escalation: the (incidentId, cycle, level) unique index reached via
 *    INSERT...ON CONFLICT DO NOTHING. currentEscalationLevel is a pre-filter only.
 *  - Exactly-once notification: written in the SAME transaction as, and only when, the
 *    event insert actually returned a row.
 *  - Safe under concurrent instances: a JobLease row, claimed via a transaction-scoped
 *    advisory lock, guards the run; the lock itself only guards the sub-millisecond
 *    claim, not the whole scan (which runs as many short per-batch transactions).
 *  - Safe under a long gap: tiersDueFor computes from highSeveritySince, not "time since
 *    last run", so 3 days of silence produces levels 1,2,3 in one pass.
 *  - The ack/escalate race is closed by re-checking acknowledgedAt/stage/currentEscalationLevel
 *    INSIDE the INSERT...SELECT...WHERE, not just in the earlier batch read.
 */
export async function runEscalationJob(deps: Deps): Promise<EscalationRunResult> {
  const { clock, logger } = deps;
  const jobRun = await jobRunRepository.start('escalation');
  const runId = await claimLease(clock);

  if (!runId) {
    await jobRunRepository.finish(jobRun.id, 'SKIPPED_LOCKED');
    return { outcome: 'SKIPPED_LOCKED', scanned: 0, escalated: 0, notified: 0 };
  }

  let scanned = 0;
  let escalated = 0;
  let notified = 0;

  try {
    const tiers = await activeTiers();
    const recipientsBySeverity: Record<'HIGH' | 'CRITICAL', { id: string }[]> = {
      HIGH: await recipientsFor('HIGH'),
      CRITICAL: await recipientsFor('CRITICAL'),
    };

    let cursor: { highSeveritySince: Date; id: string } | null = null;

    for (;;) {
      const now = clock.now();
      // Deliberate, documented exception to the "prisma.incident only in
      // incident.repository.ts" layering rule (scripts/check-layers.sh allowlists
      // src/jobs/): this is a SYSTEM scan, not an actor-scoped read, and it must see
      // every HIGH/CRITICAL incident regardless of any one user's clearance in order
      // to decide who gets notified — visibilityScope() does not apply here.
      const where: Prisma.IncidentWhereInput = {
        AND: [
          {
            acknowledgedAt: null,
            stage: { not: 'CLOSED' },
            severity: { in: ['HIGH', 'CRITICAL'] },
            highSeveritySince: { not: null },
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { highSeveritySince: { gt: cursor.highSeveritySince } },
                    { highSeveritySince: cursor.highSeveritySince, id: { gt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      };
      const batch: BatchRow[] = await prisma.incident.findMany({
        where,
        orderBy: [{ highSeveritySince: 'asc' }, { id: 'asc' }],
        take: ESCALATION_BATCH_SIZE,
        select: {
          id: true,
          severity: true,
          highSeveritySince: true,
          escalationCycle: true,
          currentEscalationLevel: true,
        },
      });

      if (batch.length === 0) break;

      const due = batch.flatMap((row: BatchRow) => {
        const candidate: EscalationCandidate = {
          id: row.id,
          severity: row.severity,
          highSeveritySince: row.highSeveritySince as Date, // non-null: filtered in the where clause
          escalationCycle: row.escalationCycle,
          currentEscalationLevel: row.currentEscalationLevel,
        };
        return tiersDueFor(candidate, tiers, now).map((tier) => ({ candidate, tier }));
      });

      if (due.length > 0) {
        const batchResult = await withTransaction(
          (tx) => escalateBatch(tx, due, recipientsBySeverity, now),
          { timeout: 30_000, maxWait: 10_000 },
        );
        escalated += batchResult.escalated;
        notified += batchResult.notified;
      }

      scanned += batch.length;

      const last: BatchRow | undefined = batch[batch.length - 1];
      if (batch.length < ESCALATION_BATCH_SIZE || !last) break;
      cursor = { highSeveritySince: last.highSeveritySince as Date, id: last.id };
      await renewLease(runId, clock);
    }

    await jobRunRepository.finish(jobRun.id, 'COMPLETED', { scanned, escalated, notified });
    return { outcome: 'COMPLETED', scanned, escalated, notified };
  } catch (err) {
    await jobRunRepository.finish(jobRun.id, 'FAILED', { scanned, escalated, notified, error: String(err) });
    throw err;
  } finally {
    await releaseLease(runId).catch((err) => logger.error({ err }, 'escalation lease release failed'));
  }
}

async function escalateBatch(
  tx: TxClient,
  due: { candidate: EscalationCandidate; tier: DueTier }[],
  recipientsBySeverity: Record<'HIGH' | 'CRITICAL', { id: string }[]>,
  now: Date,
): Promise<{ escalated: number; notified: number }> {
  let escalated = 0;
  let notified = 0;

  for (const { candidate, tier } of due) {
    const dueAt = new Date(candidate.highSeveritySince.getTime() + tier.thresholdMinutes * 60_000);
    const eventId = newId();

    // Conflict-free insert (never throws on a duplicate) whose WHERE clause re-checks
    // candidacy at statement time — this is what closes both the B2 whole-transaction
    // abort risk and the S8 ack/escalate race window.
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "EscalationEvent"
        ("id","incidentId","cycle","level","severityAtEscalation","dueAt","triggeredAt")
      SELECT ${eventId}, i."id", i."escalationCycle", ${tier.level}::int,
             i."severity", ${dueAt}::timestamp(3), ${now}::timestamp(3)
        FROM "Incident" i
       WHERE i."id" = ${candidate.id}
         AND i."escalationCycle" = ${candidate.escalationCycle}
         AND i."currentEscalationLevel" < ${tier.level}::int
         AND i."acknowledgedAt" IS NULL
         AND i."stage" <> 'CLOSED'
         AND i."severity" IN ('HIGH','CRITICAL')
      ON CONFLICT ("incidentId","cycle","level") DO NOTHING
      RETURNING "id"
    `;

    if (inserted.length === 0) continue; // already escalated, or no longer a candidate

    const recipients = recipientsBySeverity[candidate.severity as 'HIGH' | 'CRITICAL'];
    const notifyResult = await tx.notificationLog.createMany({
      data: recipients.map((r: { id: string }) => ({ escalationEventId: eventId, recipientId: r.id, createdAt: now })),
      skipDuplicates: true,
    });

    await tx.auditEvent.create({
      data: {
        incidentId: candidate.id,
        type: 'INCIDENT_ESCALATED',
        occurredAt: now,
        fromValue: String(candidate.currentEscalationLevel),
        toValue: String(tier.level),
        payload: { cycle: candidate.escalationCycle, level: tier.level, escalationEventId: eventId },
      },
    });

    await tx.incident.updateMany({
      where: { id: candidate.id, currentEscalationLevel: { lt: tier.level } },
      data: { currentEscalationLevel: tier.level, lastEscalatedAt: now },
    });

    escalated += 1;
    notified += notifyResult.count;
  }

  return { escalated, notified };
}
