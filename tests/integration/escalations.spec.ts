import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { createIncident } from '../setup/factories/incidentFactory';
import { createEscalationEvent, createNotification } from '../setup/factories/escalationFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

async function seedTiers(): Promise<void> {
  await prisma.escalationTier.createMany({
    data: [
      { severity: 'HIGH', level: 1, thresholdMinutes: 30 },
      { severity: 'CRITICAL', level: 1, thresholdMinutes: 15 },
    ],
  });
}

describe('GET /api/v1/escalations', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('401s with no token', async () => {
    const res = await request(app).get('/api/v1/escalations');
    expect(res.status).toBe(401);
  });

  it('lists only actively-escalated incidents — excludes level 0, acknowledged, and CLOSED', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const token = tokenFor(admin.id);

    const active = await createIncident(prisma, admin.id, { severity: 'HIGH', currentEscalationLevel: 1 });
    await createEscalationEvent(prisma, active.id, { cycle: 1, level: 1, severityAtEscalation: 'HIGH' });

    const notEscalated = await createIncident(prisma, admin.id, { severity: 'HIGH', currentEscalationLevel: 0 });
    void notEscalated;

    const acked = await createIncident(prisma, admin.id, {
      severity: 'HIGH',
      currentEscalationLevel: 1,
      acknowledgedAt: new Date(),
      acknowledgedById: admin.id,
    });
    await createEscalationEvent(prisma, acked.id, { cycle: 1, level: 1 });

    const closed = await createIncident(prisma, admin.id, {
      severity: 'HIGH',
      stage: 'CLOSED',
      currentEscalationLevel: 1,
      rootCause: 'A root cause long enough to satisfy the twenty character minimum.',
      correctiveAction: 'A corrective action long enough to satisfy the minimum length.',
    });
    await createEscalationEvent(prisma, closed.id, { cycle: 1, level: 1 });

    const res = await request(app).get('/api/v1/escalations').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { incidentId: string }) => i.incidentId)).toEqual([active.id]);
    expect(res.body.items[0]).toMatchObject({ severity: 'HIGH', level: 1, cycle: 1 });
  });

  it('sorts by level desc, then longest-overdue (earliest highSeveritySince) first, and paginates by cursor', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const token = tokenFor(admin.id);

    const older = await createIncident(prisma, admin.id, {
      severity: 'HIGH',
      currentEscalationLevel: 2,
      highSeveritySince: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createEscalationEvent(prisma, older.id, { cycle: 1, level: 2 });

    const newer = await createIncident(prisma, admin.id, {
      severity: 'HIGH',
      currentEscalationLevel: 2,
      highSeveritySince: new Date('2026-01-02T00:00:00.000Z'),
    });
    await createEscalationEvent(prisma, newer.id, { cycle: 1, level: 2 });

    const lowerLevel = await createIncident(prisma, admin.id, { severity: 'CRITICAL', currentEscalationLevel: 1 });
    await createEscalationEvent(prisma, lowerLevel.id, { cycle: 1, level: 1, severityAtEscalation: 'CRITICAL' });

    const page1 = await request(app).get('/api/v1/escalations').query({ pageSize: 2 }).set('Authorization', `Bearer ${token}`);
    expect(page1.body.items.map((i: { incidentId: string }) => i.incidentId)).toEqual([older.id, newer.id]);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).toBeTypeOf('string');

    const page2 = await request(app)
      .get('/api/v1/escalations')
      .query({ pageSize: 2, cursor: page1.body.nextCursor })
      .set('Authorization', `Bearer ${token}`);
    expect(page2.body.items.map((i: { incidentId: string }) => i.incidentId)).toEqual([lowerLevel.id]);
    expect(page2.body.hasMore).toBe(false);
  });

  it('a cursor minted for a different sort (notes) 422s rather than silently mis-paginating (S4)', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const foreignCursor = Buffer.from(JSON.stringify({ k: 'createdAt.id', v: [new Date().toISOString(), 'x'] })).toString(
      'base64url',
    );
    const res = await request(app)
      .get('/api/v1/escalations')
      .query({ cursor: foreignCursor })
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CURSOR_SORT_MISMATCH');
  });
});

describe('GET /api/v1/escalations/tiers', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
    await seedTiers();
  });

  it('401s with no token', async () => {
    const res = await request(app).get('/api/v1/escalations/tiers');
    expect(res.status).toBe(401);
  });

  it('is readable by any authenticated role, including a plain REPORTER (auth-open by design)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const res = await request(app).get('/api/v1/escalations/tiers').set('Authorization', `Bearer ${tokenFor(reporter.id)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tiers)).toBe(true);
    expect(res.body.tiers.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/escalations/:incidentId/events', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('403s a non-TRIAGE_MANAGER/ADMIN role even when clearance is sufficient', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH', currentEscalationLevel: 1 });
    const res = await request(app)
      .get(`/api/v1/escalations/${incident.id}/events`)
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('403s (not 404) a TRIAGE_MANAGER whose clearance is below the incident severity', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const incident = await createIncident(prisma, admin.id, { severity: 'CRITICAL', currentEscalationLevel: 1 });
    const res = await request(app)
      .get(`/api/v1/escalations/${incident.id}/events`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_CLEARANCE');
  });

  it('404s a non-existent incident', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const res = await request(app)
      .get('/api/v1/escalations/cnonexistentincidentid00/events')
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(res.status).toBe(404);
  });

  it('returns the full tier-by-tier history ordered by level', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const incident = await createIncident(prisma, admin.id, { severity: 'CRITICAL', currentEscalationLevel: 2 });
    await createEscalationEvent(prisma, incident.id, {
      cycle: 1,
      level: 1,
      severityAtEscalation: 'CRITICAL',
      triggeredAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createEscalationEvent(prisma, incident.id, {
      cycle: 1,
      level: 2,
      severityAtEscalation: 'CRITICAL',
      triggeredAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const res = await request(app)
      .get(`/api/v1/escalations/${incident.id}/events`)
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { level: number }) => e.level)).toEqual([1, 2]);
  });
});

describe('POST /api/v1/jobs/escalation/run', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('401s with no token', async () => {
    const res = await request(app).post('/api/v1/jobs/escalation/run');
    expect(res.status).toBe(401);
  });

  it('403s a non-admin', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const res = await request(app).post('/api/v1/jobs/escalation/run').set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(res.status).toBe(403);
  });

  it('an admin can trigger a run and gets a well-formed result', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const res = await request(app).post('/api/v1/jobs/escalation/run').set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(res.status).toBe(200);
    expect(['COMPLETED', 'SKIPPED_LOCKED']).toContain(res.body.outcome);
    expect(typeof res.body.scanned).toBe('number');
  });
});

describe('GET/POST /api/v1/notifications', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('401s with no token', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('lists only the caller\'s own notifications, newest first, with an unread count', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const otherManager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const incident = await createIncident(prisma, admin.id, { severity: 'HIGH', currentEscalationLevel: 1 });
    const event = await createEscalationEvent(prisma, incident.id, { cycle: 1, level: 1 });

    await createNotification(prisma, event.id, manager.id, { createdAt: new Date('2026-01-01T00:00:00.000Z') });
    await createNotification(prisma, event.id, otherManager.id);

    const res = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ incidentId: incident.id, level: 1, readAt: null });
    expect(res.body.unreadCount).toBe(1);
  });

  it('POST /:id/read marks it read idempotently, and 404s a notification belonging to someone else', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const otherManager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const incident = await createIncident(prisma, admin.id, { severity: 'HIGH', currentEscalationLevel: 1 });
    const event = await createEscalationEvent(prisma, incident.id, { cycle: 1, level: 1 });
    const notification = await createNotification(prisma, event.id, manager.id);

    const foreignRes = await request(app)
      .post(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${tokenFor(otherManager.id)}`);
    expect(foreignRes.status).toBe(404);

    const res = await request(app)
      .post(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.readAt).not.toBeNull();

    const again = await request(app)
      .post(`/api/v1/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(again.status).toBe(200);
    expect(again.body.readAt).toBe(res.body.readAt);
  });
});
