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

/**
 * The Q10 proof (build-plan.md §8.1 test 3): visibility is re-evaluated against
 * CURRENT severity on every request — there is no snapshot, no cache, no session grant
 * that survives a severity raise. Severity-raising (`PATCH /incidents/:id/severity`)
 * is Module 4's own endpoint, not yet built; the DB update here stands in for it so
 * this module's own guarantee — the read side re-checks every time — can be proven in
 * isolation, without depending on unbuilt code.
 */
describe('clearance-revoked-on-raise — Q10: visibility re-evaluated on every request, no snapshot', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('a clearance-3 user reading a HIGH incident loses access the instant it is raised to CRITICAL, and it vanishes from their list in the same breath', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const viewer = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH' });
    const token = tokenFor(viewer.id);

    const before = await request(app).get(`/api/v1/incidents/${incident.id}`).set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const beforeList = await request(app).get('/api/v1/incidents').set('Authorization', `Bearer ${token}`);
    expect(beforeList.body.items.map((i: { id: string }) => i.id)).toContain(incident.id);

    // Stands in for Module 4's PATCH /incidents/:id/severity.
    await prisma.incident.update({ where: { id: incident.id }, data: { severity: 'CRITICAL' } });

    const after = await request(app).get(`/api/v1/incidents/${incident.id}`).set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('INSUFFICIENT_CLEARANCE');

    const afterList = await request(app).get('/api/v1/incidents').set('Authorization', `Bearer ${token}`);
    expect(afterList.body.items.map((i: { id: string }) => i.id)).not.toContain(incident.id);
    expect(afterList.body.totalItems).toBe(0);
  });

  it('the mirror case: lowering the VIEWER’s own clearance mid-session, same token, has the identical effect', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const viewer = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const critical = await createIncident(prisma, reporter.id, { severity: 'CRITICAL' });
    const token = tokenFor(viewer.id);

    const before = await request(app)
      .get(`/api/v1/incidents/${critical.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    await prisma.user.update({ where: { id: viewer.id }, data: { clearanceLevel: 1 } });

    const after = await request(app)
      .get(`/api/v1/incidents/${critical.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(403);
  });
});
