import type { PrismaClient, Severity, Stage, IncidentType } from '@prisma/client';
import { newId, formatIncidentReference } from '../../src/core/ids';
import { SEVERITY_RANK } from '../../src/config/constants';
import { mulberry32, pick, intBetween } from './rng';

const TYPES: IncidentType[] = ['SAFETY', 'SECURITY', 'ENVIRONMENTAL', 'OPERATIONAL', 'DATA_PRIVACY', 'EQUIPMENT', 'OTHER'];
const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STAGES: Stage[] = ['REPORTED', 'TRIAGE', 'INVESTIGATION', 'PENDING_CLOSURE', 'CLOSED'];
const HIGH_BAND = 3; // SEVERITY_RANK.HIGH

const LOREM =
  'A routine inspection identified an irregularity that was reported through the standard channel and logged for review by the responsible team.';

interface UserRef {
  id: string;
  role: 'REPORTER' | 'TRIAGE_MANAGER' | 'INVESTIGATOR' | 'ADMIN';
  clearanceLevel: number;
}

/**
 * Every dependent column is DERIVED from severity/stage, never generated
 * independently — this is the build-plan.md finding B4 fix. Any HIGH/CRITICAL row
 * without highSeveritySince violates the high_severity_clock CHECK; any CLOSED row
 * without a real (>=20 char) rootCause/correctiveAction violates closed_requires_rca.
 * Both would make `docker compose up` fail on a fresh clone.
 *
 * Deliberately does NOT seed EscalationEvent/NotificationLog history: doing so
 * correctly requires back-filling currentEscalationLevel to match, and getting that
 * wrong is exactly the bug the escalation job's own idempotency depends on not
 * happening (see docs/escalation.md). Seeded unacknowledged HIGH/CRITICAL incidents
 * are picked up and escalated for real by the live scheduler shortly after boot.
 */
function buildIncident(
  rng: () => number,
  index: number,
  year: number,
  reporters: UserRef[],
  investigatorsByClearance: Map<number, UserRef[]>,
  managers: UserRef[],
  now: Date,
) {
  const type = pick(rng, TYPES);
  const severity = pick(rng, SEVERITIES);
  const stage = pick(rng, STAGES);
  const reporter = pick(rng, reporters);

  const daysAgo = intBetween(rng, 0, 180);
  const createdAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

  const isHighBand = SEVERITY_RANK[severity] >= HIGH_BAND;
  // Band entry is at-or-after creation, always in the past relative to `now`.
  const highSeveritySince = isHighBand
    ? new Date(createdAt.getTime() + intBetween(rng, 0, Math.max(0, daysAgo - 1)) * 60 * 60 * 1000)
    : null;

  const needsAssignee = stage === 'INVESTIGATION' || stage === 'PENDING_CLOSURE' || stage === 'CLOSED';
  let assignedInvestigatorId: string | null = null;
  if (needsAssignee) {
    const requiredRank = SEVERITY_RANK[severity];
    const eligible = [3, 4]
      .filter((c) => c >= requiredRank)
      .flatMap((c) => investigatorsByClearance.get(c) ?? []);
    const pool = eligible.length > 0 ? eligible : (investigatorsByClearance.get(4) ?? []);
    if (pool.length > 0) assignedInvestigatorId = pick(rng, pool).id;
  }

  const isClosed = stage === 'CLOSED';
  // PENDING_CLOSURE only exists via closure.service.ts::propose, which always sets
  // rootCause/correctiveAction/closureProposedById/closureProposedAt in the same
  // write — a PENDING_CLOSURE row without them is a state the real app can never
  // produce, and leaves the manager's closure-review screen with nothing to approve
  // or reject.
  const hasProposedClosure = stage === 'PENDING_CLOSURE' || isClosed;
  const closureProposedAt = hasProposedClosure
    ? new Date(createdAt.getTime() + intBetween(rng, 1, Math.max(1, daysAgo)) * 60 * 60 * 1000)
    : null;
  const closedAt = isClosed && closureProposedAt ? new Date(closureProposedAt.getTime() + intBetween(rng, 1, 72) * 60 * 60 * 1000) : null;

  // ~60% of high-band, non-closed incidents are acknowledged — leaves a realistic mix
  // of escalation candidates for the live scheduler to find after boot.
  const acknowledgedAt =
    isHighBand && !isClosed && rng() < 0.6 && highSeveritySince
      ? new Date(highSeveritySince.getTime() + intBetween(rng, 1, 45) * 60_000)
      : null;
  const acknowledgedById = acknowledgedAt ? pick(rng, managers).id : null;

  return {
    id: newId(),
    reference: formatIncidentReference(year, index + 1),
    type,
    severity,
    stage,
    title: `${type.replace('_', ' ')} incident #${index + 1}`,
    description: LOREM,
    reporterId: reporter.id,
    assignedInvestigatorId,
    acknowledgedById,
    acknowledgedAt,
    highSeveritySince,
    escalationCycle: isHighBand ? 1 : 0,
    currentEscalationLevel: 0,
    lastEscalatedAt: null,
    rootCause: hasProposedClosure ? 'Root cause: ' + LOREM : null,
    correctiveAction: hasProposedClosure ? 'Corrective action: implemented additional controls and retraining.' : null,
    closureProposedById: hasProposedClosure ? (assignedInvestigatorId ?? pick(rng, managers).id) : null,
    closureProposedAt,
    closedById: isClosed ? pick(rng, managers).id : null,
    closedAt,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function seedIncidents(prisma: PrismaClient, targetCount: number, seed: string): Promise<void> {
  const existing = await prisma.incident.count();
  if (existing >= targetCount) {
    // eslint-disable-next-line no-console
    console.log(`incidents already seeded (${existing} >= ${targetCount}), skipping`);
    return;
  }
  const toCreate = targetCount - existing;

  const [reporters, investigators, managers] = await Promise.all([
    prisma.user.findMany({ where: { role: 'REPORTER' }, select: { id: true, role: true, clearanceLevel: true } }),
    prisma.user.findMany({ where: { role: 'INVESTIGATOR' }, select: { id: true, role: true, clearanceLevel: true } }),
    prisma.user.findMany({ where: { role: { in: ['TRIAGE_MANAGER', 'ADMIN'] } }, select: { id: true, role: true, clearanceLevel: true } }),
  ]);

  const investigatorsByClearance = new Map<number, UserRef[]>();
  for (const inv of investigators as UserRef[]) {
    const list = investigatorsByClearance.get(inv.clearanceLevel) ?? [];
    list.push(inv);
    investigatorsByClearance.set(inv.clearanceLevel, list);
  }

  const rng = mulberry32(seed);
  const now = new Date();
  const year = now.getUTCFullYear();

  const BATCH = 500;
  for (let start = 0; start < toCreate; start += BATCH) {
    const batchSize = Math.min(BATCH, toCreate - start);
    const rows = Array.from({ length: batchSize }, (_, i) =>
      buildIncident(rng, existing + start + i, year, reporters as UserRef[], investigatorsByClearance, managers as UserRef[], now),
    );
    await prisma.incident.createMany({ data: rows });
    // eslint-disable-next-line no-console
    console.log(`seeded ${Math.min(start + batchSize, toCreate)}/${toCreate} incidents`);
  }

  // Advance the reference sequence past every seeded reference so the next
  // app-created incident cannot collide with one we just inserted.
  await prisma.$executeRawUnsafe(`SELECT setval('incident_reference_seq', ${targetCount}, true)`);
}
