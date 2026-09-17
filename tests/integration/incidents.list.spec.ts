import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { createIncident } from '../setup/factories/incidentFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

describe('GET /api/v1/incidents — filters', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('401s with no token', async () => {
    const res = await request(app).get('/api/v1/incidents');
    expect(res.status).toBe(401);
  });

  it('filters by stage, type, assignedToMe, reportedByMe, unacknowledged and escalatedOnly independently', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const token = tokenFor(admin.id);

    const triageStage = await createIncident(prisma, admin.id, { stage: 'TRIAGE', type: 'SAFETY' });
    await createIncident(prisma, admin.id, { stage: 'REPORTED', type: 'SECURITY' });
    const assigned = await createIncident(prisma, admin.id, {
      stage: 'INVESTIGATION',
      type: 'OPERATIONAL',
      assignedInvestigatorId: investigator.id,
    });
    const investigatorReported = await createIncident(prisma, investigator.id, { type: 'OTHER' });
    const unacked = await createIncident(prisma, admin.id, {
      severity: 'HIGH',
      type: 'EQUIPMENT',
      acknowledgedAt: null,
    });
    const escalated = await createIncident(prisma, admin.id, { type: 'DATA_PRIVACY', currentEscalationLevel: 2 });

    const stageRes = await request(app).get('/api/v1/incidents').query({ stage: 'TRIAGE' }).set('Authorization', `Bearer ${token}`);
    expect(stageRes.body.items.map((i: { id: string }) => i.id)).toEqual([triageStage.id]);

    const typeRes = await request(app).get('/api/v1/incidents').query({ type: 'SAFETY' }).set('Authorization', `Bearer ${token}`);
    expect(typeRes.body.items.map((i: { id: string }) => i.id)).toEqual([triageStage.id]);

    const assignedRes = await request(app)
      .get('/api/v1/incidents')
      .query({ assignedToMe: 'true' })
      .set('Authorization', `Bearer ${tokenFor(investigator.id)}`);
    expect(assignedRes.body.items.map((i: { id: string }) => i.id)).toEqual([assigned.id]);

    const reportedRes = await request(app)
      .get('/api/v1/incidents')
      .query({ reportedByMe: 'true' })
      .set('Authorization', `Bearer ${tokenFor(investigator.id)}`);
    expect(reportedRes.body.items.map((i: { id: string }) => i.id)).toEqual([investigatorReported.id]);

    const unackedRes = await request(app)
      .get('/api/v1/incidents')
      .query({ unacknowledged: 'true', severity: 'HIGH' })
      .set('Authorization', `Bearer ${token}`);
    expect(unackedRes.body.items.map((i: { id: string }) => i.id)).toEqual([unacked.id]);

    const escalatedRes = await request(app)
      .get('/api/v1/incidents')
      .query({ escalatedOnly: 'true' })
      .set('Authorization', `Bearer ${token}`);
    expect(escalatedRes.body.items.map((i: { id: string }) => i.id)).toEqual([escalated.id]);
  });

  it('a text query matches title (case-insensitive) or reference', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const incident = await createIncident(prisma, admin.id, {});
    await prisma.incident.update({ where: { id: incident.id }, data: { title: 'Loading dock spill' } });

    const byTitle = await request(app)
      .get('/api/v1/incidents')
      .query({ q: 'loading dock' })
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(byTitle.body.items.map((i: { id: string }) => i.id)).toEqual([incident.id]);

    const byReference = await request(app)
      .get('/api/v1/incidents')
      .query({ q: incident.reference })
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(byReference.body.items.map((i: { id: string }) => i.id)).toEqual([incident.id]);
  });

  it('a date-only `to` includes the whole final day (B1/S4 half-open boundary)', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const incident = await createIncident(prisma, admin.id, {});
    const createdAt = new Date('2026-06-15T23:30:00.000Z');
    await prisma.incident.update({ where: { id: incident.id }, data: { createdAt } });

    const res = await request(app)
      .get('/api/v1/incidents')
      .query({ from: '2026-06-15', to: '2026-06-15' })
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);

    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([incident.id]);
  });

  it('a malformed id 422s at the validation layer rather than falling through to a 404 (S7)', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const res = await request(app)
      .get('/api/v1/incidents/not-a-real-id!!')
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/incidents/summary', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('401s with no token', async () => {
    const res = await request(app).get('/api/v1/incidents/summary');
    expect(res.status).toBe(401);
  });

  it('zero-fills every stage, scoped to the actor clearance, from one groupBy', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    await createIncident(prisma, admin.id, { stage: 'TRIAGE' });
    await createIncident(prisma, admin.id, { stage: 'TRIAGE' });
    await createIncident(prisma, admin.id, { stage: 'REPORTED' });

    const res = await request(app).get('/api/v1/incidents/summary').set('Authorization', `Bearer ${tokenFor(admin.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      REPORTED: 1,
      TRIAGE: 2,
      INVESTIGATION: 0,
      PENDING_CLOSURE: 0,
      CLOSED: 0,
    });
  });
});
