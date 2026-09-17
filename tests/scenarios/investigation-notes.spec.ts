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

function listNotes(id: string, token: string, query = '') {
  return request(app)
    .get(`/api/v1/incidents/${id}/notes${query}`)
    .set('Authorization', `Bearer ${token}`);
}

function addNote(id: string, token: string, body: string) {
  return request(app)
    .post(`/api/v1/incidents/${id}/notes`)
    .set('Authorization', `Bearer ${token}`)
    .send({ body });
}

describe('Module 5 — Investigation & Notes (build-plan.md §10, walkthrough Q2/Q24)', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('the reporter of a LOW incident they CAN see still gets 403 NOT_ASSIGNED_INVESTIGATOR', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'LOW',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const res = await listNotes(incident.id, tokenFor(reporter.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ASSIGNED_INVESTIGATOR');
  });

  it('a clearance-4 triage manager gets 403 NOT_ASSIGNED_INVESTIGATOR — clearance alone is insufficient (Q24)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'CRITICAL',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const res = await listNotes(incident.id, tokenFor(manager.id));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ASSIGNED_INVESTIGATOR');
  });

  it('the assigned investigator gets 200 and can add a note; the audit payload stores {noteId, length}, never the body', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'LOW',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const list = await listNotes(incident.id, tokenFor(investigator.id));
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
    expect(list.body.hasMore).toBe(false);

    const body = 'Interviewed the shift supervisor about the sequence of events.';
    const created = await addNote(incident.id, tokenFor(investigator.id), body);
    expect(created.status).toBe(201);
    expect(created.body.body).toBe(body);
    expect(created.body.author).toMatchObject({ id: investigator.id });

    const audit = await prisma.auditEvent.findFirst({ where: { incidentId: incident.id, type: 'NOTE_ADDED' } });
    expect(audit?.payload).toEqual({ noteId: created.body.id, length: body.length });
    expect(JSON.stringify(audit?.payload)).not.toContain('shift supervisor');
  });

  it('an ADMIN gets 200 on notes for any incident, assigned or not', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const incident = await createIncident(prisma, reporter.id, { severity: 'CRITICAL', stage: 'INVESTIGATION' });

    const res = await listNotes(incident.id, tokenFor(admin.id));

    expect(res.status).toBe(200);
  });

  it('a severity raise above the assignee\'s own clearance loses them BOTH gates at once — 403 INSUFFICIENT_CLEARANCE (clearance is checked first)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const before = await listNotes(incident.id, tokenFor(investigator.id));
    expect(before.status).toBe(200);

    const raise = await request(app)
      .patch(`/api/v1/incidents/${incident.id}/severity`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0')
      .send({ severity: 'CRITICAL', reason: 'new evidence of wider impact' });
    expect(raise.status).toBe(200);
    expect(raise.body.assignedInvestigator).toBeNull();

    // Q17's mustUnassignOnRaise fires at the exact same clearance threshold as
    // visibilityScope, so this investigator loses the incident entirely, not just the
    // assignment — the clearance gate (checked first, via getByIdForActor) reports it.
    const after = await listNotes(incident.id, tokenFor(investigator.id));
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe('INSUFFICIENT_CLEARANCE');
  });

  it('reassignment alone (severity unchanged) revokes the FORMER assignee\'s note access instantly — 403 NOT_ASSIGNED_INVESTIGATOR, distinct from a clearance refusal', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const first = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const second = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: first.id,
    });

    const before = await listNotes(incident.id, tokenFor(first.id));
    expect(before.status).toBe(200);

    const reassign = await request(app)
      .post(`/api/v1/incidents/${incident.id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0')
      .send({ investigatorId: second.id });
    expect(reassign.status).toBe(200);

    // `first` still has clearance to VIEW this HIGH incident — only the assignment gate
    // now fails, so the code must be NOT_ASSIGNED_INVESTIGATOR, not INSUFFICIENT_CLEARANCE.
    const afterFirst = await listNotes(incident.id, tokenFor(first.id));
    expect(afterFirst.status).toBe(403);
    expect(afterFirst.body.error.code).toBe('NOT_ASSIGNED_INVESTIGATOR');

    const afterSecond = await listNotes(incident.id, tokenFor(second.id));
    expect(afterSecond.status).toBe(200);
  });

  it('no PATCH/DELETE route exists for a note — the path 404s rather than falling into an update handler', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'LOW',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const res = await request(app)
      .patch(`/api/v1/incidents/${incident.id}/notes/${newId()}`)
      .set('Authorization', `Bearer ${tokenFor(investigator.id)}`)
      .send({ body: 'edited' });

    expect(res.status).toBe(404);
  });

  it('adding a note is refused 409 INVALID_STAGE_TRANSITION (meta.reason NOTES_CLOSED) once the incident is CLOSED', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'LOW',
      stage: 'CLOSED',
      assignedInvestigatorId: investigator.id,
    });

    const res = await addNote(incident.id, tokenFor(investigator.id), 'a note after closure');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STAGE_TRANSITION');
    expect(res.body.error.meta).toMatchObject({ reason: 'NOTES_CLOSED' });
  });

  it('cursor pagination returns each note exactly once, including three notes sharing the same millisecond createdAt', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 1 });
    const incident = await createIncident(prisma, reporter.id, {
      severity: 'LOW',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });

    const sameInstant = new Date('2026-01-01T00:00:00.000Z');
    const olderInstant = new Date('2025-12-31T00:00:00.000Z');
    const tied = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        prisma.investigationNote.create({
          data: {
            id: newId(),
            incidentId: incident.id,
            authorId: investigator.id,
            body: `tied note ${i}`,
            createdAt: sameInstant,
          },
        }),
      ),
    );
    const older = await prisma.investigationNote.create({
      data: { id: newId(), incidentId: incident.id, authorId: investigator.id, body: 'older note', createdAt: olderInstant },
    });

    const token = tokenFor(investigator.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const res = await listNotes(incident.id, token, `?pageSize=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((n: { id: string }) => n.id));
      if (!res.body.hasMore) break;
      cursor = res.body.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([...tied.map((n) => n.id), older.id].sort());
  });

  it('GET /investigations/mine returns the investigator\'s assigned, clearance-visible incidents', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 3 });
    const mine = await createIncident(prisma, reporter.id, {
      severity: 'HIGH',
      stage: 'INVESTIGATION',
      assignedInvestigatorId: investigator.id,
    });
    const notMine = await createIncident(prisma, reporter.id, { severity: 'HIGH', stage: 'TRIAGE' });

    const res = await request(app)
      .get('/api/v1/investigations/mine')
      .set('Authorization', `Bearer ${tokenFor(investigator.id)}`);

    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id);
  });

  it('a REPORTER cannot reach /investigations/mine (403 INSUFFICIENT_ROLE)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 4 });

    const res = await request(app)
      .get('/api/v1/investigations/mine')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });
});
