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

describe('clearance-by-id — §8.1 the sharpest test in this POC', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('a clearance-2 user requesting a HIGH incident by id gets 403, with no incident data in the body', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const viewer = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH' });

    const res = await request(app)
      .get(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', `Bearer ${tokenFor(viewer.id)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_CLEARANCE');
    expect(res.body).not.toHaveProperty('title');
    expect(res.body).not.toHaveProperty('description');
    expect(res.body).not.toHaveProperty('severity');
  });

  it('the identical id with clearance 3 succeeds', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const viewer = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH' });

    const res = await request(app)
      .get(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', `Bearer ${tokenFor(viewer.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.severity).toBe('HIGH');
  });

  it('a non-existent id is 404; an existing-but-restricted id is 403 (Q12)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const viewer = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'CRITICAL' });

    const notFound = await request(app)
      .get(`/api/v1/incidents/${newId()}`)
      .set('Authorization', `Bearer ${tokenFor(viewer.id)}`);
    expect(notFound.status).toBe(404);

    const restricted = await request(app)
      .get(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', `Bearer ${tokenFor(viewer.id)}`);
    expect(restricted.status).toBe(403);
  });

  it('a refusal writes exactly one deduped ACCESS_DENIED audit row, never turning the 403 into a 500', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const viewer = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'CRITICAL' });
    const token = tokenFor(viewer.id);

    await request(app).get(`/api/v1/incidents/${incident.id}`).set('Authorization', `Bearer ${token}`);
    const secondRes = await request(app)
      .get(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(secondRes.status).toBe(403);
    const events = await prisma.auditEvent.findMany({
      where: { type: 'ACCESS_DENIED', incidentId: incident.id, actorId: viewer.id },
    });
    // Deduped within the short window — two refusals in a row still write one row.
    expect(events).toHaveLength(1);
  });

  it("a reporter's own CRITICAL incident is absent from GET /incidents/mine (Q9)", async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    await createIncident(prisma, reporter.id, { severity: 'CRITICAL' });
    const lowIncident = await createIncident(prisma, reporter.id, { severity: 'LOW' });

    const res = await request(app)
      .get('/api/v1/incidents/mine')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([lowIncident.id]);
    expect(res.body.totalItems).toBe(1);
  });

  it('?severity=CRITICAL from a clearance-2 user returns an empty page, not an error and not data', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    await createIncident(prisma, reporter.id, { severity: 'CRITICAL' });
    const viewer = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });

    const res = await request(app)
      .get('/api/v1/incidents')
      .query({ severity: 'CRITICAL' })
      .set('Authorization', `Bearer ${tokenFor(viewer.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalItems).toBe(0);
  });

  it('pagination totalItems reflects the scoped set, not the global set', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    await createIncident(prisma, reporter.id, { severity: 'LOW' });
    await createIncident(prisma, reporter.id, { severity: 'LOW' });
    await createIncident(prisma, reporter.id, { severity: 'CRITICAL' });
    await createIncident(prisma, reporter.id, { severity: 'CRITICAL' });

    const viewer = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 1 });
    const res = await request(app)
      .get('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(viewer.id)}`);

    expect(res.status).toBe(200);
    // 4 incidents exist globally, but clearance 1 can only ever see the 2 LOW ones.
    expect(res.body.totalItems).toBe(2);
    expect(res.body.items).toHaveLength(2);
  });
});
