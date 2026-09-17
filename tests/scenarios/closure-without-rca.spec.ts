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

function propose(id: string, token: string, version: number, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/incidents/${id}/closure-proposal`)
    .set('Authorization', `Bearer ${token}`)
    .set('If-Match', String(version))
    .send(body);
}

function approve(id: string, token: string, version: number, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/v1/incidents/${id}/closure-approval`)
    .set('Authorization', `Bearer ${token}`)
    .set('If-Match', String(version))
    .send(body);
}

function reject(id: string, token: string, version: number, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/incidents/${id}/closure-rejection`)
    .set('Authorization', `Bearer ${token}`)
    .set('If-Match', String(version))
    .send(body);
}

const RCA = 'The valve was left open after the last maintenance cycle.';
const CORRECTIVE = 'Added a checklist step to confirm valve position before sign-off.';

describe('Module 6 — Closure (build-plan.md §Module 6, walkthrough question 1)', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('gate 1: an empty rootCause is rejected 422 and the stage is unchanged', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const res = await propose(incident.id, tokenFor(investigator.id), 0, {
      rootCause: '',
      correctiveAction: CORRECTIVE,
    });

    expect(res.status).toBe(422);
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.stage).toBe('INVESTIGATION');
    expect(row.version).toBe(0);
  });

  it('gate 1: whitespace-only fields are rejected 422 — trim happens before the length check (S6)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const res = await propose(incident.id, tokenFor(investigator.id), 0, {
      rootCause: '   \n\n   ',
      correctiveAction: CORRECTIVE,
    });

    expect(res.status).toBe(422);
  });

  it('a non-assignee investigator cannot propose closure — 403 NOT_ASSIGNED_INVESTIGATOR', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const assignee = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const otherInvestigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: assignee.id,
    });

    const res = await propose(incident.id, tokenFor(otherInvestigator.id), 0, {
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ASSIGNED_INVESTIGATOR');
  });

  it('gate 3: approving directly on an INVESTIGATION incident (no proposal) is 409 INVALID_STAGE_TRANSITION', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'HIGH', stage: 'INVESTIGATION' });

    const res = await approve(incident.id, tokenFor(manager.id), 0);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
  });

  it('gate 2: approve accepts no body keys — a smuggled rootCause/correctiveAction is 422, and the incident is NOT closed', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'PENDING_CLOSURE',
      rootCause: null,
      correctiveAction: null,
    });

    const res = await approve(incident.id, tokenFor(manager.id), 0, { rootCause: 'x', correctiveAction: 'y' });

    expect(res.status).toBe(422);
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.stage).toBe('PENDING_CLOSURE');
  });

  it('gate 3: RCA nulled by raw SQL after a legitimate proposal is refused by the service re-read, not the request', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'PENDING_CLOSURE',
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });

    // Bypasses the app entirely — simulates a hole in the request path, proving the
    // service's OWN re-read (not merely "the request happened to carry good data") is
    // what refuses this, independent of how the row got into this state.
    await prisma.$executeRawUnsafe(`UPDATE "Incident" SET "rootCause" = NULL WHERE id = $1`, incident.id);

    const res = await approve(incident.id, tokenFor(manager.id), 0);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLOSURE_REQUIREMENTS_MISSING');
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.stage).toBe('PENDING_CLOSURE');
  });

  it('gate 4: the closed_requires_rca CHECK constraint rejects a raw SQL close with null RCA, and the whitespace-only variant too (S6)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'PENDING_CLOSURE',
      rootCause: null,
      correctiveAction: null,
    });

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Incident" SET stage = 'CLOSED' WHERE id = $1`, incident.id),
    ).rejects.toThrow();

    await prisma.$executeRawUnsafe(
      `UPDATE "Incident" SET "rootCause" = $1, "correctiveAction" = $1 WHERE id = $2`,
      '\n\n   \n',
      incident.id,
    );
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Incident" SET stage = 'CLOSED' WHERE id = $1`, incident.id),
    ).rejects.toThrow();
  });

  it('happy path: propose then approve closes the incident and writes CLOSURE_PROPOSED/CLOSURE_APPROVED audit rows', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const proposed = await propose(incident.id, tokenFor(investigator.id), 0, {
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });
    expect(proposed.status).toBe(200);
    expect(proposed.body.stage).toBe('PENDING_CLOSURE');
    expect(proposed.body.rootCause).toBe(RCA);

    const approved = await approve(incident.id, tokenFor(manager.id), proposed.body.version);
    expect(approved.status).toBe(200);
    expect(approved.body.stage).toBe('CLOSED');
    expect(approved.body.closure).toMatchObject({ closedBy: { id: manager.id } });
    expect(approved.body._actions).toMatchObject({
      canTriage: false,
      canAssign: false,
      canProposeClosure: false,
      canApproveClosure: false,
    });

    const proposedAudit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: 'CLOSURE_PROPOSED' } });
    expect(proposedAudit).toMatchObject({ payload: { rootCauseLength: RCA.length, correctiveActionLength: CORRECTIVE.length } });
    const approvedAudit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: 'CLOSURE_APPROVED' } });
    expect(approvedAudit).toBeTruthy();
    const stageChanges = await prisma.auditEvent.findMany({ where: { incidentId: incident.id, type: 'STAGE_CHANGED' } });
    expect(stageChanges.map((e) => e.toValue)).toEqual(expect.arrayContaining(['PENDING_CLOSURE', 'CLOSED']));
  });

  it('reject sends the incident back to INVESTIGATION with the RCA text RETAINED, and writes a CLOSURE_REJECTED audit row with the reason', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'PENDING_CLOSURE',
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });

    const res = await reject(incident.id, tokenFor(manager.id), 0, { reason: 'Corrective action is too vague — add a specific owner.' });

    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('INVESTIGATION');
    expect(res.body.rootCause).toBe(RCA);
    expect(res.body.correctiveAction).toBe(CORRECTIVE);
    expect(res.body.closure).toBeNull();

    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: 'CLOSURE_REJECTED' } });
    expect(audit).toMatchObject({ reason: 'Corrective action is too vague — add a specific owner.' });
  });

  it('rejection only applies from PENDING_CLOSURE — attempting it on a TRIAGE-stage incident is 409, not a silent transition to INVESTIGATION', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'TRIAGE' });

    const res = await reject(incident.id, tokenFor(manager.id), 0, { reason: 'not actually pending closure' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(row.stage).toBe('TRIAGE');
  });

  it('a closed incident is frozen — further notes, severity changes and assignment are all 409', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'CLOSED',
      assignedInvestigatorId: investigator.id,
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });

    const note = await request(app)
      .post(`/api/v1/incidents/${incident.id}/notes`)
      .set('Authorization', `Bearer ${tokenFor(investigator.id)}`)
      .send({ body: 'trying to add a note after closure' });
    expect(note.status).toBe(409);

    const severity = await request(app)
      .patch(`/api/v1/incidents/${incident.id}/severity`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0')
      .send({ severity: 'CRITICAL', reason: 'trying to raise after closure' });
    expect(severity.status).toBe(409);

    const assignment = await request(app)
      .post(`/api/v1/incidents/${incident.id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0')
      .send({ investigatorId: investigator.id });
    expect(assignment.status).toBe(409);
  });

  it('GET /closures/pending returns PENDING_CLOSURE incidents scoped by clearance', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });

    const visible = await createIncident(prisma, reporter.id, {
      severity: 'MEDIUM',
      stage: 'PENDING_CLOSURE',
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });
    const outOfClearance = await createIncident(prisma, reporter.id, {
      severity: 'CRITICAL',
      stage: 'PENDING_CLOSURE',
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });
    const wrongStage = await createIncident(prisma, reporter.id, { severity: 'LOW', stage: 'INVESTIGATION' });

    const res = await request(app)
      .get('/api/v1/closures/pending')
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(outOfClearance.id);
    expect(ids).not.toContain(wrongStage.id);
  });

  it('a REPORTER cannot reach the approval/rejection routes (403 INSUFFICIENT_ROLE)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'LOW',
      stage: 'PENDING_CLOSURE',
      rootCause: RCA,
      correctiveAction: CORRECTIVE,
    });

    const res = await approve(incident.id, tokenFor(reporter.id), 0);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });
});
