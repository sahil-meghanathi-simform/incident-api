/**
 * Module 11 hardening: load-test the escalation job at 5,000 open incidents across
 * repeated quick-succession runs (build-plan.md "Module 11 — Hardening").
 *
 * Boots its own throwaway Testcontainers Postgres (same pattern as
 * tests/setup/globalSetup.ts) so this never touches the shared devdb or requires
 * `docker compose up` — fully self-contained and reproducible. Not part of `npm test`
 * (it is deliberately slow and prints a report rather than asserting via Vitest); run
 * it on demand with `npm run test:load`.
 *
 * Seeds exactly 5,000 candidate incidents (unacknowledged, non-CLOSED, HIGH/CRITICAL)
 * with staggered `highSeveritySince` offsets so that, at the frozen "now" used below,
 * some are due for L1 only, some for L1+L2, and some for the full L1+L2+L3 — the same
 * "long gap" shape build-plan.md's B2 fix targets, but at scale. A further 500
 * HIGH/CRITICAL rows are seeded already acknowledged/CLOSED specifically to prove the
 * job's partial index (`incident_escalation_candidates`) and WHERE clause exclude them
 * from every scan, not just from the final due-tier filter.
 *
 * Expected due-tier counts are computed here via the same pure `tiersDueFor` the job
 * itself uses, so "did the job produce exactly the right number of events" is a real
 * assertion against an independently-derived expectation, not an eyeballed print.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const CANDIDATE_COUNT = 5000;
const EXCLUDED_COUNT = 500; // acknowledged/CLOSED HIGH/CRITICAL rows the scan must skip
const RECIPIENTS_PER_ROLE_SEVERITY = 10;

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters-long';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters-long';
  process.env.LOG_LEVEL ??= 'silent';

  console.log('Starting throwaway Postgres 16 container...');
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16')
    .withDatabase('incident_loadtest')
    .withUsername('incident')
    .withPassword('incident')
    .start();

  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;

  console.log('Applying migrations...');
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  // Imported AFTER DATABASE_URL is set — src/db/prisma.ts reads it at import time.
  const { runEscalationJob, tiersDueFor } = await import('../src/jobs/escalation.job');
  const { FrozenClock } = await import('../src/core/time');
  const { rootLogger } = await import('../src/core/logger');
  const { newId } = await import('../src/core/ids');

  const prisma = new PrismaClient();

  try {
    console.log('Seeding tiers, users, and 5,000 candidate incidents...');
    await prisma.escalationTier.createMany({
      data: [
        { severity: 'HIGH', level: 1, thresholdMinutes: 30 },
        { severity: 'HIGH', level: 2, thresholdMinutes: 90 },
        { severity: 'HIGH', level: 3, thresholdMinutes: 240 },
        { severity: 'CRITICAL', level: 1, thresholdMinutes: 15 },
        { severity: 'CRITICAL', level: 2, thresholdMinutes: 60 },
        { severity: 'CRITICAL', level: 3, thresholdMinutes: 240 },
      ],
    });

    const reporter = await prisma.user.create({
      data: {
        id: newId(),
        email: 'load-test-reporter@incident.local',
        passwordHash: 'x',
        displayName: 'Load Test Reporter',
        role: 'REPORTER',
        clearanceLevel: 1,
      },
    });

    const recipients: { id: string }[] = [];
    for (const role of ['TRIAGE_MANAGER', 'ADMIN'] as const) {
      for (let i = 0; i < RECIPIENTS_PER_ROLE_SEVERITY; i++) {
        recipients.push(
          await prisma.user.create({
            data: {
              id: newId(),
              email: `load-test-${role.toLowerCase()}-${i}@incident.local`,
              passwordHash: 'x',
              displayName: `Load Test ${role} ${i}`,
              role,
              clearanceLevel: 4,
            },
          }),
        );
      }
    }

    const now = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FrozenClock(now);
    const tiers = [
      { id: '1', severity: 'HIGH' as const, level: 1, thresholdMinutes: 30 },
      { id: '2', severity: 'HIGH' as const, level: 2, thresholdMinutes: 90 },
      { id: '3', severity: 'HIGH' as const, level: 3, thresholdMinutes: 240 },
      { id: '4', severity: 'CRITICAL' as const, level: 1, thresholdMinutes: 15 },
      { id: '5', severity: 'CRITICAL' as const, level: 2, thresholdMinutes: 60 },
      { id: '6', severity: 'CRITICAL' as const, level: 3, thresholdMinutes: 240 },
    ];

    // Deterministic stagger: offsets cycle 0..299 minutes ago, severity alternates.
    // Computed with the SAME tiersDueFor the job uses, so the expectation below is
    // derived independently of the job's own SQL, not just a mirrored guess.
    let expectedEvents = 0;
    const candidateData = [];
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
      const severity = i % 2 === 0 ? ('HIGH' as const) : ('CRITICAL' as const);
      const offsetMinutes = i % 300;
      const highSeveritySince = new Date(now.getTime() - offsetMinutes * 60_000);
      expectedEvents += tiersDueFor(
        { id: String(i), severity, highSeveritySince, escalationCycle: 1, currentEscalationLevel: 0 },
        tiers,
        now,
      ).length;

      candidateData.push({
        id: newId(),
        reference: `INC-LOAD-${String(i).padStart(6, '0')}`,
        type: 'SAFETY' as const,
        severity,
        stage: 'INVESTIGATION' as const,
        title: `Load test incident ${i}`,
        description: 'A description long enough to satisfy validation rules in every test context.',
        reporterId: reporter.id,
        highSeveritySince,
        escalationCycle: 1,
        currentEscalationLevel: 0,
      });
    }

    // Excluded rows: HIGH/CRITICAL but already acknowledged, or CLOSED — must never
    // appear in the job's scan at all (the partial index's own WHERE excludes them).
    const excludedData = [];
    for (let i = 0; i < EXCLUDED_COUNT; i++) {
      const severity = i % 2 === 0 ? ('HIGH' as const) : ('CRITICAL' as const);
      const acknowledged = i % 2 === 0;
      excludedData.push({
        id: newId(),
        reference: `INC-LOADX-${String(i).padStart(6, '0')}`,
        type: 'SAFETY' as const,
        severity,
        stage: acknowledged ? ('INVESTIGATION' as const) : ('CLOSED' as const),
        title: `Load test excluded incident ${i}`,
        description: 'A description long enough to satisfy validation rules in every test context.',
        reporterId: reporter.id,
        highSeveritySince: new Date(now.getTime() - 250 * 60_000),
        escalationCycle: 1,
        currentEscalationLevel: acknowledged ? 0 : 3,
        acknowledgedAt: acknowledged ? now : null,
        acknowledgedById: acknowledged ? reporter.id : null,
        rootCause: acknowledged ? null : 'A root cause long enough to satisfy the twenty character minimum.',
        correctiveAction: acknowledged ? null : 'A corrective action long enough to satisfy the minimum length.',
        closedAt: acknowledged ? null : now,
        closedById: acknowledged ? null : reporter.id,
      });
    }

    await prisma.incident.createMany({ data: candidateData });
    await prisma.incident.createMany({ data: excludedData });

    console.log(
      `Seeded ${CANDIDATE_COUNT} candidates (expecting ${expectedEvents} escalation events on the first run) ` +
        `+ ${EXCLUDED_COUNT} excluded rows + ${recipients.length} recipients.\n`,
    );

    const results: { label: string; ms: number; outcome: string; scanned: number; escalated: number; notified: number }[] = [];

    const timedRun = async (label: string) => {
      const start = performance.now();
      const result = await runEscalationJob({ clock, logger: rootLogger });
      const ms = performance.now() - start;
      results.push({ label, ms, outcome: result.outcome, scanned: result.scanned, escalated: result.escalated, notified: result.notified });
      return result;
    };

    console.log('Run 1 — first pass over all 5,000 candidates (cold, most expensive)...');
    await timedRun('run 1 (cold)');

    console.log('Run 2 — immediately back-to-back (idempotency check)...');
    await timedRun('run 2 (immediate re-run)');

    console.log('Runs 3+4 — fired concurrently via Promise.all (simulates a double-click on [Run now])...');
    const concurrentStart = performance.now();
    const [r3, r4] = await Promise.all([timedRun('run 3 (concurrent A)'), timedRun('run 4 (concurrent B)')]);
    const concurrentMs = performance.now() - concurrentStart;

    const actualEvents = await prisma.escalationEvent.count();
    const actualNotifications = await prisma.notificationLog.count();
    const excludedTouched = await prisma.escalationEvent.count({
      where: { incident: { reference: { startsWith: 'INC-LOADX-' } } },
    });

    console.log('\n=== Results ===');
    for (const r of results) {
      console.log(
        `${r.label.padEnd(24)} ${r.ms.toFixed(1).padStart(8)}ms  outcome=${r.outcome.padEnd(14)} ` +
          `scanned=${String(r.scanned).padStart(5)} escalated=${String(r.escalated).padStart(5)} notified=${String(r.notified).padStart(6)}`,
      );
    }
    console.log(`\nConcurrent pair wall-clock: ${concurrentMs.toFixed(1)}ms (one COMPLETED/SKIPPED_LOCKED pair: ${r3.outcome}/${r4.outcome})`);
    console.log(`\nTotal EscalationEvent rows: ${actualEvents} (expected exactly ${expectedEvents})`);
    console.log(`Total NotificationLog rows: ${actualNotifications} (expected exactly ${expectedEvents * RECIPIENTS_PER_ROLE_SEVERITY * 2})`);
    console.log(`EscalationEvent rows touching an excluded incident: ${excludedTouched} (expected exactly 0)`);

    const pass =
      actualEvents === expectedEvents &&
      actualNotifications === expectedEvents * RECIPIENTS_PER_ROLE_SEVERITY * 2 &&
      excludedTouched === 0 &&
      // A missing run is itself a failure, so an absent entry must not read as 0
      // escalations and quietly pass — `?? -1` makes the comparison fail instead.
      (results[1]?.escalated ?? -1) === 0 &&
      (results[2]?.escalated ?? -1) + (results[3]?.escalated ?? -1) === 0;

    console.log(`\n${pass ? 'PASS' : 'FAIL'} — idempotent, correct event/notification counts, excluded rows never touched.`);
    if (!pass) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await container.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
