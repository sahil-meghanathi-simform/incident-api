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

function patchSeverity(id: string, token: string, version: number, body: { severity: string; reason: string }) {
  return request(app)
    .patch(`/api/v1/incidents/${id}/severity`)
    .set('Authorization', `Bearer ${token}`)
    .set('If-Match', String(version))
    .send(body);
}

describe('Module 4 — Triage, Severity & Assignment (build-plan.md §9.1)', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('POST /:id/triage moves REPORTED -> TRIAGE and writes a STAGE_CHANGED audit row', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'REPORTED' });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident.id}/triage`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0');

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('TRIAGE');
    expect(res.body.version).toBe(1);

    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: 'STAGE_CHANGED' } });
    expect(audit).toMatchObject({ fromValue: 'REPORTED', toValue: 'TRIAGE' });
  });

  it('an illegal transition (REPORTED -> TRIAGE attempted twice) is 409 INVALID_STAGE_TRANSITION', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'TRIAGE' });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident.id}/triage`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
  });

  it('a mutation without an If-Match header is rejected 422 before any business logic runs', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'REPORTED' });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident.id}/triage`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);

    expect(res.status).toBe(422);
  });

  it('a clearance-2 triager cannot change a HIGH incident\'s severity — 403 from the scoped load, before any rule runs', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH' });

    const res = await patchSeverity(incident.id, tokenFor(manager.id), 0, {
      severity: 'CRITICAL',
      reason: 'escalating per policy',
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_CLEARANCE');

    const unchanged = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(unchanged.severity).toBe('HIGH');
    expect(unchanged.version).toBe(0);
  });

  it('a no-op severity change is refused 409 SEVERITY_UNCHANGED', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH' });

    const res = await patchSeverity(incident.id, tokenFor(manager.id), 0, { severity: 'HIGH', reason: 'no change at all' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SEVERITY_UNCHANGED');
  });

  it('HIGH -> CRITICAL auto-unassigns a clearance-3 investigator and returns the incident to TRIAGE, with both audit rows', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const res = await patchSeverity(incident.id, tokenFor(manager.id), 0, {
      severity: 'CRITICAL',
      reason: 'new evidence of wider impact',
    });

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('TRIAGE');
    expect(res.body.assignedInvestigator).toBeNull();

    const unassigned = await prisma.auditEvent.findFirst({
      where: { incidentId: incident.id, type: 'INVESTIGATOR_UNASSIGNED' },
    });
    expect(unassigned).toMatchObject({ fromValue: investigator.id, reason: 'CLEARANCE_BELOW_NEW_SEVERITY' });

    const stageChanged = await prisma.auditEvent.findFirst({
      where: { incidentId: incident.id, type: 'STAGE_CHANGED' },
    });
    expect(stageChanged).toMatchObject({ fromValue: 'INVESTIGATION', toValue: 'TRIAGE' });
  });

  it('assigning a clearance-2 investigator to a CRITICAL incident is refused 409 with {required: 4, actual: 2}', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 2 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'CRITICAL', stage: 'TRIAGE' });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident.id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0')
      .send({ investigatorId: investigator.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVESTIGATOR_CLEARANCE_TOO_LOW');
    expect(res.body.error.meta).toEqual({ required: 4, actual: 2 });
  });

  it('assigning from TRIAGE advances the stage to INVESTIGATION', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH', stage: 'TRIAGE' });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident.id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0')
      .send({ investigatorId: investigator.id });

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('INVESTIGATION');
    expect(res.body.assignedInvestigator).toMatchObject({ id: investigator.id });
  });

  it('reassignment writes both INVESTIGATOR_UNASSIGNED (old) and INVESTIGATOR_ASSIGNED (new)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const first = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const second = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: first.id,
    });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident.id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0')
      .send({ investigatorId: second.id });

    expect(res.status).toBe(200);
    expect(res.body.assignedInvestigator).toMatchObject({ id: second.id });

    const events = await prisma.auditEvent.findMany({
      where: { incidentId: incident.id, type: { in: ['INVESTIGATOR_UNASSIGNED', 'INVESTIGATOR_ASSIGNED'] } },
    });
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.type === 'INVESTIGATOR_UNASSIGNED')).toMatchObject({ fromValue: first.id });
    expect(events.find((e) => e.type === 'INVESTIGATOR_ASSIGNED')).toMatchObject({ toValue: second.id });
  });

  it('DELETE /:id/assignment unassigns and returns an INVESTIGATION incident to TRIAGE', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const res = await request(app)
      .delete(`/api/v1/incidents/${incident.id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0');

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('TRIAGE');
    expect(res.body.assignedInvestigator).toBeNull();
  });

  it('unassigning an incident with no assignee is refused 409 NO_INVESTIGATOR_ASSIGNED', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'TRIAGE' });

    const res = await request(app)
      .delete(`/api/v1/incidents/${incident.id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_INVESTIGATOR_ASSIGNED');
  });

  it('POST /:id/acknowledge stamps the acknowledgement; a second acknowledge is refused 409 ALREADY_ACKNOWLEDGED', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH' });

    const first = await request(app)
      .post(`/api/v1/incidents/${incident.id}/acknowledge`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0');

    expect(first.status).toBe(200);
    expect(first.body.acknowledgement.acknowledgedBy).toMatchObject({ id: manager.id });

    const second = await request(app)
      .post(`/api/v1/incidents/${incident.id}/acknowledge`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '1');

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_ACKNOWLEDGED');
  });

  it('re-raising after acknowledgement clears acknowledgedAt and bumps escalationCycle', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      escalationCycle: 1,
      acknowledgedAt: new Date(),
      acknowledgedById: manager.id,
    });

    const res = await patchSeverity(incident.id, tokenFor(manager.id), 0, {
      severity: 'CRITICAL',
      reason: 'condition has worsened overnight',
    });

    expect(res.status).toBe(200);
    expect(res.body.acknowledgement).toBeNull();
    expect(res.body.escalation.currentEscalationLevel).toBe(0);

    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.escalationCycle).toBe(2);
    expect(row.acknowledgedAt).toBeNull();
  });

  it('S1: lowering CRITICAL -> HIGH keeps the escalation clock, cycle and level untouched — no 5xx', async () => {
    const highSeveritySince = new Date(Date.now() - 60 * 60 * 1000);
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'CRITICAL',
      highSeveritySince,
      escalationCycle: 2,
      currentEscalationLevel: 2,
    });

    const res = await patchSeverity(incident.id, tokenFor(manager.id), 0, {
      severity: 'HIGH',
      reason: 'impact assessment revised downward',
    });

    expect(res.status).toBe(200);
    expect(res.body.escalation.currentEscalationLevel).toBe(2);
    expect(new Date(res.body.escalation.highSeveritySince).getTime()).toBe(highSeveritySince.getTime());

    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.escalationCycle).toBe(2);
  });

  it('a self-inflicted raise above the ACTOR\'s own clearance still WRITES successfully — the response is 403, not 404 or 500', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH' });

    const res = await patchSeverity(incident.id, tokenFor(manager.id), 0, {
      severity: 'CRITICAL',
      reason: 'raising past my own clearance on purpose',
    });

    // The write committed even though the read-back that would normally accompany a
    // 200 response is now denied to the actor who just made it — that must surface as
    // 403 INSUFFICIENT_CLEARANCE (a re-evaluation of Q10, not a new rule), never a 404
    // (the incident did not disappear) and never a 500 (the mutation is not the thing
    // that failed).
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_CLEARANCE');

    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.severity).toBe('CRITICAL');
    expect(row.version).toBe(1);
  });

  it('two concurrent severity changes on the same version: exactly one wins, the other gets STALE_VERSION', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'LOW' });
    const token = tokenFor(manager.id);

    const [a, b] = await Promise.all([
      patchSeverity(incident.id, token, 0, { severity: 'MEDIUM', reason: 'first concurrent change' }),
      patchSeverity(incident.id, token, 0, { severity: 'HIGH', reason: 'second concurrent change' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('STALE_VERSION');

    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.version).toBe(1);
  });

  it('GET /triage/queue returns unacknowledged HIGH+ and REPORTED/TRIAGE incidents, scoped by clearance', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 3 });

    const newReport = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'REPORTED' });
    const unackedHigh = await createIncident(prisma, reporter.id, { severity: 'HIGH', stage: 'INVESTIGATION' });
    const ackedHigh = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      acknowledgedAt: new Date(),
      acknowledgedById: manager.id,
    });
    const settledInvestigation = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'INVESTIGATION' });
    const outOfClearance = await createIncident(prisma, reporter.id, { severity: 'CRITICAL', stage: 'REPORTED' });

    const res = await request(app)
      .get('/api/v1/triage/queue')
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(newReport.id);
    expect(ids).toContain(unackedHigh.id);
    expect(ids).not.toContain(ackedHigh.id);
    expect(ids).not.toContain(settledInvestigation.id);
    expect(ids).not.toContain(outOfClearance.id);
  });

  it('a REPORTER cannot reach any Module 4 action route (403 INSUFFICIENT_ROLE)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'LOW' });

    const res = await request(app)
      .post(`/api/v1/incidents/${incident.id}/triage`)
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .set('If-Match', '0');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });
});
