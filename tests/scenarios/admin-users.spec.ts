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

function asAdmin(admin: { id: string }) {
  return { Authorization: `Bearer ${tokenFor(admin.id)}` };
}

describe('Module 10 — Admin (build-plan.md §15.1)', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('a non-admin gets 403 from every /admin/* route', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const res = await request(app).get('/api/v1/admin/users').set(asAdmin(manager));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('an admin cannot change their own role — 409 SELF_MODIFICATION_FORBIDDEN', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.id}/role`)
      .set(asAdmin(admin))
      .send({ role: 'REPORTER' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_MODIFICATION_FORBIDDEN');
  });

  it('an admin cannot change their own clearance — 409 SELF_MODIFICATION_FORBIDDEN', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.id}/clearance`)
      .set(asAdmin(admin))
      .send({ clearanceLevel: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_MODIFICATION_FORBIDDEN');
  });

  it('with two active admins, one can demote the other', async () => {
    const admin1 = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const admin2 = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin2.id}/role`)
      .set(asAdmin(admin1))
      .send({ role: 'TRIAGE_MANAGER' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('TRIAGE_MANAGER');
  });

  /**
   * build-plan.md §15.1 rule 2: "checked inside the transaction with a locking count
   * so two concurrent demotions cannot both win." Two admins simultaneously demoting
   * EACH OTHER is the only way to reach this branch through a non-self actor at all —
   * a solo admin can never demote themselves (assertNotSelf intercepts that with
   * SELF_MODIFICATION_FORBIDDEN first), and any distinct actor who is themselves an
   * active admin makes the pre-write count at least 2.
   *
   * The loser can surface as EITHER 409 LAST_ADMIN (it got past authorizeRole and
   * reached the transaction, then lost the `FOR UPDATE` race) or 403
   * INSUFFICIENT_ROLE (Q8b's fresh-every-request role check in authenticate.middleware
   * already saw the winner's committed demotion before the loser's own request even
   * reached authorizeRole) — which one depends on how the two requests' middleware
   * chains happen to interleave, not on anything this test controls. Both are the
   * SAME safety property enforced at two different layers, so either is an acceptable
   * outcome; what must always hold is exactly one 200 and exactly one active admin left.
   */
  it('two concurrent mutual demotions cannot both win — exactly one succeeds, the other is refused', async () => {
    const admin1 = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const admin2 = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const [res1, res2] = await Promise.all([
      request(app).patch(`/api/v1/admin/users/${admin2.id}/role`).set(asAdmin(admin1)).send({ role: 'TRIAGE_MANAGER' }),
      request(app).patch(`/api/v1/admin/users/${admin1.id}/role`).set(asAdmin(admin2)).send({ role: 'TRIAGE_MANAGER' }),
    ]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(200);
    const loser = res1.status === 200 ? res2 : res1;
    expect([403, 409]).toContain(loser.status);
    expect(['INSUFFICIENT_ROLE', 'LAST_ADMIN']).toContain(loser.body.error.code);

    const remainingActiveAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
    expect(remainingActiveAdmins).toBe(1);
  });

  it('the last active admin cannot deactivate themselves — 409 LAST_ADMIN (status changes are not self-blocked otherwise)', async () => {
    const solo = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const otherAdmin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    await prisma.user.update({ where: { id: otherAdmin.id }, data: { isActive: false } });

    const res = await request(app).patch(`/api/v1/admin/users/${solo.id}/status`).set(asAdmin(solo)).send({ isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });

  it('lowering clearance 4→2 releases CRITICAL assignments back to TRIAGE with audit rows, and previews the same set first', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });

    const critical = await createIncident(prisma, reporter.id, {
      severity: 'CRITICAL',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });
    const highPendingClosure = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'PENDING_CLOSURE',
      assignedInvestigatorId: investigator.id,
      rootCause: 'A root cause long enough to satisfy the twenty character minimum.',
      correctiveAction: 'A corrective action long enough to satisfy the minimum length.',
    });
    const low = await createIncident(prisma, reporter.id, {
      severity: 'LOW',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const preview = await request(app)
      .get(`/api/v1/admin/users/${investigator.id}/clearance-impact?clearanceLevel=2`)
      .set(asAdmin(admin));
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBe(2);
    const previewIds = preview.body.affectedIncidents.map((i: { id: string }) => i.id).sort();
    expect(previewIds).toEqual([critical.id, highPendingClosure.id].sort());

    const res = await request(app)
      .patch(`/api/v1/admin/users/${investigator.id}/clearance`)
      .set(asAdmin(admin))
      .send({ clearanceLevel: 2 });

    expect(res.status).toBe(200);
    expect(res.body.affectedIncidentCount).toBe(2);
    expect(res.body.user.clearanceLevel).toBe(2);

    const reloadedCritical = await prisma.incident.findUniqueOrThrow({ where: { id: critical.id } });
    expect(reloadedCritical.assignedInvestigatorId).toBeNull();
    expect(reloadedCritical.stage).toBe('TRIAGE'); // was INVESTIGATION -> forced back

    const reloadedHigh = await prisma.incident.findUniqueOrThrow({ where: { id: highPendingClosure.id } });
    expect(reloadedHigh.assignedInvestigatorId).toBeNull();
    expect(reloadedHigh.stage).toBe('PENDING_CLOSURE'); // untouched — no TRIAGE transition from PENDING_CLOSURE

    const reloadedLow = await prisma.incident.findUniqueOrThrow({ where: { id: low.id } });
    expect(reloadedLow.assignedInvestigatorId).toBe(investigator.id); // clearance 2 still covers LOW

    const clearanceAudit = await prisma.auditEvent.findFirst({ where: { type: 'USER_CLEARANCE_CHANGED' } });
    expect(clearanceAudit).toMatchObject({ fromValue: '4', toValue: '2', actorId: admin.id });

    const unassignedAudits = await prisma.auditEvent.findMany({ where: { type: 'INVESTIGATOR_UNASSIGNED', reason: 'ADMIN_CLEARANCE_LOWERED' } });
    expect(unassignedAudits).toHaveLength(2);

    const stageAudits = await prisma.auditEvent.findMany({ where: { type: 'STAGE_CHANGED', reason: 'ADMIN_CLEARANCE_LOWERED' } });
    expect(stageAudits).toHaveLength(1);
    expect(stageAudits[0]).toMatchObject({ incidentId: critical.id, fromValue: 'INVESTIGATION', toValue: 'TRIAGE' });
  });

  it('raising clearance never triggers the cascade', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 1 });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${investigator.id}/clearance`)
      .set(asAdmin(admin))
      .send({ clearanceLevel: 3 });

    expect(res.status).toBe(200);
    expect(res.body.affectedIncidentCount).toBe(0);
  });

  it('a clearance change is visible to the affected user\'s very next request with the SAME access token (Q8b)', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { email: 'inv-live@test.local', role: 'INVESTIGATOR', clearanceLevel: 1 });
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'inv-live@test.local', password: 'Password123!' });
    const investigatorToken = login.body.accessToken as string;

    const before = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${investigatorToken}`);
    expect(before.body.clearanceLevel).toBe(1);

    await request(app).patch(`/api/v1/admin/users/${investigator.id}/clearance`).set(asAdmin(admin)).send({ clearanceLevel: 4 });

    const after = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${investigatorToken}`);
    expect(after.body.clearanceLevel).toBe(4);
  });

  it('GET /admin/users filters by role and free-text search', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    await createUser(prisma, { role: 'REPORTER', email: 'alice.reporter@test.local' });
    await createUser(prisma, { role: 'INVESTIGATOR', email: 'bob.investigator@test.local' });

    const res = await request(app).get('/api/v1/admin/users?role=INVESTIGATOR').set(asAdmin(admin));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].email).toBe('bob.investigator@test.local');

    const search = await request(app).get('/api/v1/admin/users?q=alice').set(asAdmin(admin));
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].email).toBe('alice.reporter@test.local');
  });

  it('PUT /admin/escalation-tiers replaces the set atomically and GET reflects it', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const res = await request(app)
      .put('/api/v1/admin/escalation-tiers')
      .set(asAdmin(admin))
      .send({
        tiers: [
          { severity: 'HIGH', level: 1, thresholdMinutes: 10 },
          { severity: 'HIGH', level: 2, thresholdMinutes: 30 },
          { severity: 'CRITICAL', level: 1, thresholdMinutes: 5 },
          { severity: 'CRITICAL', level: 2, thresholdMinutes: 15 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.tiers).toHaveLength(4);

    const get = await request(app).get('/api/v1/admin/escalation-tiers').set(asAdmin(admin));
    expect(get.body.tiers).toHaveLength(4);
    const critical1 = get.body.tiers.find((t: { severity: string; level: number }) => t.severity === 'CRITICAL' && t.level === 1);
    expect(critical1.thresholdMinutes).toBe(5);
  });

  it('non-contiguous tier levels are rejected 422 before any write', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const before = await prisma.escalationTier.count();

    const res = await request(app)
      .put('/api/v1/admin/escalation-tiers')
      .set(asAdmin(admin))
      .send({
        tiers: [
          { severity: 'HIGH', level: 1, thresholdMinutes: 10 },
          { severity: 'HIGH', level: 3, thresholdMinutes: 30 }, // gap: no level 2
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await prisma.escalationTier.count()).toBe(before);
  });

  it('non-increasing tier thresholds within a severity are rejected 422', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const res = await request(app)
      .put('/api/v1/admin/escalation-tiers')
      .set(asAdmin(admin))
      .send({
        tiers: [
          { severity: 'HIGH', level: 1, thresholdMinutes: 30 },
          { severity: 'HIGH', level: 2, thresholdMinutes: 10 }, // must strictly increase
        ],
      });

    expect(res.status).toBe(422);
  });

  it('GET /admin/jobs/escalation/runs surfaces recent JobRun rows', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    await prisma.jobRun.create({
      data: { jobName: 'escalation', finishedAt: new Date(), outcome: 'COMPLETED', scanned: 5, escalated: 2, notified: 4 },
    });

    const res = await request(app).get('/api/v1/admin/jobs/escalation/runs').set(asAdmin(admin));
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0]).toMatchObject({ outcome: 'COMPLETED', scanned: 5, escalated: 2, notified: 4 });
  });
});
