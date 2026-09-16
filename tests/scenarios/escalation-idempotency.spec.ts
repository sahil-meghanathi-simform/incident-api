import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runEscalationJob } from '../../src/jobs/escalation.job';
import { FrozenClock } from '../../src/core/time';
import { rootLogger } from '../../src/core/logger';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { createIncident } from '../setup/factories/incidentFactory';

// A fresh PrismaClient bound to whatever DATABASE_URL globalSetup landed on. Created
// lazily (not at module top-level import time is fine here — globalSetup has already
// run and set process.env.DATABASE_URL before Vitest even imports this file).
const prisma = new PrismaClient();

async function seedTiers() {
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
}

describe('escalation job — §6 "safe if it runs, or is checked, more than once"', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await seedTiers();
  });

  it('running the job twice back-to-back creates exactly one event and one notification per recipient', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const clock = new FrozenClock(new Date('2026-01-01T00:00:00.000Z'));

    await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      highSeveritySince: clock.now(),
      escalationCycle: 1,
    });

    clock.advance(31 * 60_000); // cross the 30-minute L1 threshold

    const r1 = await runEscalationJob({ clock, logger: rootLogger });
    const r2 = await runEscalationJob({ clock, logger: rootLogger });

    expect(r1.outcome).toBe('COMPLETED');
    expect(r2.outcome).toBe('COMPLETED');
    expect(await prisma.escalationEvent.count()).toBe(1);
    expect(await prisma.notificationLog.count({ where: { recipientId: manager.id } })).toBe(1);
  });

  it('is a no-op when currentEscalationLevel disagrees with EscalationEvent history (the reference-plan bug this replaces)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const clock = new FrozenClock(new Date('2026-01-01T00:00:00.000Z'));

    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      highSeveritySince: clock.now(),
      escalationCycle: 1,
    });

    clock.advance(31 * 60_000);
    await runEscalationJob({ clock, logger: rootLogger }); // creates the level-1 event

    const before = await prisma.escalationEvent.count();
    const beforeNotifs = await prisma.notificationLog.count();

    // Force the disagreement directly, bypassing the job.
    await prisma.incident.update({ where: { id: incident.id }, data: { currentEscalationLevel: 0 } });

    const result = await runEscalationJob({ clock, logger: rootLogger });

    // Must complete cleanly — NOT throw, NOT roll back the run (build-plan.md finding B2:
    // the reference plan's try/catch(isUniqueViolation) cannot recover here because
    // Prisma issues no SAVEPOINTs and the conflict aborts the whole transaction).
    expect(result.outcome).toBe('COMPLETED');
    expect(await prisma.escalationEvent.count()).toBe(before);
    expect(await prisma.notificationLog.count()).toBe(beforeNotifs);
  });

  it('Promise.all([run(), run()]) yields exactly one COMPLETED and one SKIPPED_LOCKED', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const clock = new FrozenClock(new Date('2026-01-01T00:00:00.000Z'));

    await createIncident(prisma, reporter.id, {
      severity: 'CRITICAL',
      stage: 'INVESTIGATION',
      highSeveritySince: clock.now(),
      escalationCycle: 1,
    });
    clock.advance(16 * 60_000);

    const [a, b] = await Promise.all([
      runEscalationJob({ clock, logger: rootLogger }),
      runEscalationJob({ clock, logger: rootLogger }),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['COMPLETED', 'SKIPPED_LOCKED']);
    expect(await prisma.escalationEvent.count()).toBe(1);
  });

  it('a 3-day gap with no runs produces levels 1, 2 and 3 in one pass, one row each', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const clock = new FrozenClock(new Date('2026-01-01T00:00:00.000Z'));
    const bandEntry = clock.now();

    await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      highSeveritySince: bandEntry,
      escalationCycle: 1,
    });

    clock.advance(3 * 24 * 60 * 60_000);
    const result = await runEscalationJob({ clock, logger: rootLogger });

    expect(result.escalated).toBe(3);
    const events = await prisma.escalationEvent.findMany({ orderBy: { level: 'asc' } });
    expect(events.map((e) => e.level)).toEqual([1, 2, 3]);
    // build-plan.md finding S5: the injected clock, not the DB default, supplies triggeredAt.
    for (const e of events) {
      expect(e.triggeredAt.getTime()).toBe(clock.now().getTime());
    }
  });

  it('acknowledging, then running, produces no new events and leaves history intact', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const clock = new FrozenClock(new Date('2026-01-01T00:00:00.000Z'));

    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      highSeveritySince: clock.now(),
      escalationCycle: 1,
    });
    clock.advance(31 * 60_000);
    await runEscalationJob({ clock, logger: rootLogger });

    await prisma.incident.update({
      where: { id: incident.id },
      data: { acknowledgedAt: clock.now(), acknowledgedById: manager.id },
    });

    const before = await prisma.escalationEvent.count();
    clock.advance(60 * 60_000);
    const result = await runEscalationJob({ clock, logger: rootLogger });

    expect(result.escalated).toBe(0);
    expect(await prisma.escalationEvent.count()).toBe(before);
  });

  it('closed incidents are excluded from the candidate set entirely', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const clock = new FrozenClock(new Date('2026-01-01T00:00:00.000Z'));

    await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'CLOSED',
      assignedInvestigatorId: investigator.id,
      highSeveritySince: clock.now(),
      escalationCycle: 1,
    });
    clock.advance(5 * 24 * 60 * 60_000);

    const result = await runEscalationJob({ clock, logger: rootLogger });
    expect(result.scanned).toBe(0);
    expect(result.escalated).toBe(0);
  });

  it('a clearance-2 triage manager receives no notification for a CRITICAL escalation (Q9 holds for notifications too)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const lowClearanceManager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });
    const highClearanceManager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const clock = new FrozenClock(new Date('2026-01-01T00:00:00.000Z'));

    await createIncident(prisma, reporter.id, {
      severity: 'CRITICAL',
      stage: 'INVESTIGATION',
      highSeveritySince: clock.now(),
      escalationCycle: 1,
    });
    clock.advance(16 * 60_000);

    await runEscalationJob({ clock, logger: rootLogger });

    expect(await prisma.notificationLog.count({ where: { recipientId: lowClearanceManager.id } })).toBe(0);
    expect(await prisma.notificationLog.count({ where: { recipientId: highClearanceManager.id } })).toBe(1);
  });
});
