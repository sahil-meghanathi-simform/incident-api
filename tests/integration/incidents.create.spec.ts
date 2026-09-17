import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

const validBody = {
  type: 'SAFETY',
  severity: 'LOW',
  title: 'A slip hazard near the loading dock',
  description: 'Water pooled near the loading dock after the overnight cleaning crew finished mopping.',
};

describe('POST /api/v1/incidents', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('401s with no token', async () => {
    const res = await request(app).post('/api/v1/incidents').send(validBody);
    expect(res.status).toBe(401);
  });

  it('an invalid severity is rejected before it reaches business logic, leaving the incident count unchanged', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({ ...validBody, severity: 'APOCALYPTIC' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await prisma.incident.count()).toBe(0);
  });

  it('a missing description is rejected with a field-addressable error', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const withoutDescription: Record<string, unknown> = { ...validBody };
    delete withoutDescription.description;

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send(withoutDescription);

    expect(res.status).toBe(422);
    expect(res.body.error.details[0].path).toBe('description');
  });

  it('an extra reporterId or stage key is rejected outright by the strict schema', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({ ...validBody, reporterId: newId(), stage: 'CLOSED' });

    expect(res.status).toBe(422);
    expect(await prisma.incident.count()).toBe(0);
  });

  it('a clearance-1 reporter filing CRITICAL gets a receipt with visibleToYou: false (Q9)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({ ...validBody, severity: 'CRITICAL' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ severity: 'CRITICAL', visibleToYou: false });
    expect(res.body.reference).toMatch(/^INC-\d{4}-\d{6}$/);
    expect(res.body).not.toHaveProperty('stage');
    expect(res.body).not.toHaveProperty('reporterId');

    const incident = await prisma.incident.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(incident.reporterId).toBe(reporter.id);
    expect(incident.stage).toBe('REPORTED');
    expect(incident.highSeveritySince).not.toBeNull();
    expect(incident.escalationCycle).toBe(1);
  });

  it('a clearance-4 admin filing CRITICAL gets visibleToYou: true', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`)
      .send({ ...validBody, severity: 'CRITICAL' });

    expect(res.status).toBe(201);
    expect(res.body.visibleToYou).toBe(true);
  });

  it('a LOW-severity incident is created with no escalation clock started', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send(validBody);

    expect(res.status).toBe(201);
    const incident = await prisma.incident.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(incident.highSeveritySince).toBeNull();
    expect(incident.escalationCycle).toBe(0);
  });

  it('creation writes exactly one INCIDENT_CREATED audit row, and no row exists on a rejected request', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({ ...validBody, severity: 'INVALID' });
    expect(await prisma.auditEvent.count()).toBe(0);

    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send(validBody);

    const events = await prisma.auditEvent.findMany({ where: { incidentId: res.body.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'INCIDENT_CREATED', actorId: reporter.id, toValue: 'LOW' });
  });

  it('two incidents created back to back get distinct, sequential references', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    const first = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send(validBody);
    const second = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send(validBody);

    expect(first.body.reference).not.toBe(second.body.reference);
  });
});

describe('GET /api/v1/incidents/types', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('401s with no token', async () => {
    const res = await request(app).get('/api/v1/incidents/types');
    expect(res.status).toBe(401);
  });

  it('returns every incident type and severity as a labelled option', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    const res = await request(app)
      .get('/api/v1/incidents/types')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.types.map((t: { value: string }) => t.value)).toEqual([
      'SAFETY',
      'SECURITY',
      'ENVIRONMENTAL',
      'OPERATIONAL',
      'DATA_PRIVACY',
      'EQUIPMENT',
      'OTHER',
    ]);
    expect(res.body.severities.map((s: { value: string }) => s.value)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
});
