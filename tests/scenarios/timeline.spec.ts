import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { flushPendingDenials } from '../../src/modules/audit/audit.service';
import { createUser } from '../setup/factories/userFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

function timeline(id: string, token: string, query = '') {
  return request(app)
    .get(`/api/v1/incidents/${id}/timeline${query}`)
    .set('Authorization', `Bearer ${token}`);
}

describe('Module 8 — Audit & Timeline (build-plan.md §13, implementation-plan.md §13)', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('a full lifecycle produces the exact ordered, correctly-shaped event chain, newest first', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });
    const managerToken = tokenFor(manager.id);
    const investigatorToken = tokenFor(investigator.id);

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({
        type: 'SAFETY',
        severity: 'LOW',
        title: 'A slip hazard near the loading dock',
        description: 'Water pooled near the loading dock after the overnight cleaning crew finished mopping.',
        noImageReason: 'Test fixture — no photo captured for this scenario.',
      });
    expect(created.status).toBe(201);
    const id: string = created.body.id;

    const triaged = await request(app)
      .post(`/api/v1/incidents/${id}/triage`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('If-Match', '0');
    expect(triaged.status).toBe(200);

    const assigned = await request(app)
      .post(`/api/v1/incidents/${id}/assignment`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('If-Match', '1')
      .send({ investigatorId: investigator.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.stage).toBe('INVESTIGATION');

    const noteBody = 'Interviewed the shift supervisor about the mopping schedule that evening.';
    const note = await request(app)
      .post(`/api/v1/incidents/${id}/notes`)
      .set('Authorization', `Bearer ${investigatorToken}`)
      .send({ body: noteBody });
    expect(note.status).toBe(201);

    const raised = await request(app)
      .patch(`/api/v1/incidents/${id}/severity`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('If-Match', '2')
      .send({ severity: 'HIGH', reason: 'a second slip was reported in the same spot' });
    expect(raised.status).toBe(200);

    const acked = await request(app)
      .post(`/api/v1/incidents/${id}/acknowledge`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('If-Match', '3');
    expect(acked.status).toBe(200);

    const proposed = await request(app)
      .post(`/api/v1/incidents/${id}/closure-proposal`)
      .set('Authorization', `Bearer ${investigatorToken}`)
      .set('If-Match', '4')
      .send({
        rootCause: 'Mop water was not fully squeegeed before the area reopened to traffic.',
        correctiveAction: 'Added a mandatory dry-time checklist step before reopening any mopped area.',
      });
    expect(proposed.status).toBe(200);

    const approved = await request(app)
      .post(`/api/v1/incidents/${id}/closure-approval`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('If-Match', '5')
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.stage).toBe('CLOSED');

    const res = await timeline(id, managerToken, '?pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);

    // Newest-first, verified two ways that both avoid asserting exact order WITHIN a
    // single mutation's own transaction (two rows written with the identical injected
    // `now` tie-break purely on cuid2 id, which is not time-sortable): (1) occurredAt
    // is non-increasing end to end, and (2) the exact multiset of 11 event types is
    // present — nothing lost, nothing duplicated. The two unambiguous BOUNDARY
    // positions (the very first write, the very last) are asserted exactly, since
    // nothing else in the chain can tie with either of those.
    const items: Array<{ type: string; occurredAt: string }> = res.body.items;
    expect(items.length).toBe(11);
    for (let i = 1; i < items.length; i += 1) {
      expect(new Date(items[i - 1].occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(items[i].occurredAt).getTime());
    }
    expect(items[items.length - 1].type).toBe('INCIDENT_CREATED');
    // The newest two rows are the closure-approval transaction's own pair
    // (CLOSURE_APPROVED + STAGE_CHANGED -> CLOSED, same injected `now`) — which of the
    // two sorts first is an id-tie-break artifact, not something the API promises.
    expect(items.slice(0, 2).map((e) => e.type).sort()).toEqual(['CLOSURE_APPROVED', 'STAGE_CHANGED']);

    expect(items.map((e) => e.type).sort()).toEqual(
      [
        'INCIDENT_CREATED',
        'STAGE_CHANGED',
        'INVESTIGATOR_ASSIGNED',
        'STAGE_CHANGED',
        'NOTE_ADDED',
        'SEVERITY_CHANGED',
        'INCIDENT_ACKNOWLEDGED',
        'CLOSURE_PROPOSED',
        'STAGE_CHANGED',
        'CLOSURE_APPROVED',
        'STAGE_CHANGED',
      ].sort(),
    );

    const byType = <T,>(type: string): T => res.body.items.find((e: { type: string }) => e.type === type);

    const createdEvt = byType<{ severity: string; incidentType: string; stage: string; actor: { id: string } }>(
      'INCIDENT_CREATED',
    );
    expect(createdEvt).toMatchObject({ severity: 'LOW', incidentType: 'SAFETY', stage: 'REPORTED' });
    expect(createdEvt.actor.id).toBe(reporter.id);

    const assignedEvt = byType<{ investigator: { id: string; displayName: string } }>('INVESTIGATOR_ASSIGNED');
    expect(assignedEvt.investigator).toMatchObject({ id: investigator.id });

    // The manager is neither the assignee nor ADMIN, so — per Q24, the same two-gate
    // rule Module 5 built — even this full-clearance viewer sees the redacted stub.
    // The dedicated redaction test below covers the assignee's full view.
    const noteEvt = byType<{ redacted: boolean; length: number | null; noteId: string | null }>('NOTE_ADDED');
    expect(noteEvt).toMatchObject({ redacted: true, length: null, noteId: null });

    const severityEvt = byType<{ from: string; to: string; reason: string }>('SEVERITY_CHANGED');
    expect(severityEvt).toMatchObject({ from: 'LOW', to: 'HIGH', reason: 'a second slip was reported in the same spot' });

    const closureProposedEvt = byType<{ rootCauseLength: number; correctiveActionLength: number }>('CLOSURE_PROPOSED');
    expect(closureProposedEvt.rootCauseLength).toBeGreaterThanOrEqual(20);

    // The note body itself never appears anywhere in the audit table (§13.1's
    // string-scan assertion) — not in this timeline response, and not in the raw rows.
    expect(JSON.stringify(res.body)).not.toContain('mopping schedule');
    const rows = await prisma.auditEvent.findMany({ where: { incidentId: id } });
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain('mopping schedule');
    }
  });

  it('cursor pagination returns every event exactly once and reassembles to match the full page', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const managerToken = tokenFor(manager.id);

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({
        type: 'SAFETY',
        severity: 'LOW',
        title: 'A recurring paginated incident',
        description: 'Description long enough to satisfy validation rules in every test context.',
        noImageReason: 'Test fixture — no photo captured for this scenario.',
      });
    const id: string = created.body.id;

    // Drive four more STAGE_CHANGED-free but still-audited transitions isn't available
    // without more mutations, so pad with triage + three ack/severity round trips is
    // overkill — three raw audit rows inserted directly cover the pagination law just
    // as well as a longer real chain would, without re-testing Module 4/6's own writes.
    const now = Date.now();
    await prisma.auditEvent.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        id: newId(),
        incidentId: id,
        actorId: manager.id,
        type: 'STAGE_CHANGED' as const,
        fromValue: 'TRIAGE',
        toValue: 'INVESTIGATION',
        occurredAt: new Date(now - i * 1000),
      })),
    });

    const full = await timeline(id, managerToken, '?pageSize=100');
    expect(full.body.items.length).toBe(6); // 5 inserted + INCIDENT_CREATED

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const res = await timeline(id, managerToken, `?pageSize=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((e: { id: string }) => e.id));
      if (!res.body.hasMore) break;
      cursor = res.body.nextCursor;
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(full.body.items.map((e: { id: string }) => e.id).sort());
  });

  it('NOTE_ADDED is redacted ({type, occurredAt, redacted:true}, no actor/noteId/length) for a viewer who cannot read notes, and full for the assignee', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
    const investigator = await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 });

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({
        type: 'SAFETY',
        severity: 'LOW',
        title: 'Redaction check incident',
        description: 'Description long enough to satisfy validation rules in every test context.',
        noImageReason: 'Test fixture — no photo captured for this scenario.',
      });
    const id: string = created.body.id;

    await request(app)
      .post(`/api/v1/incidents/${id}/triage`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '0');
    await request(app)
      .post(`/api/v1/incidents/${id}/assignment`)
      .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
      .set('If-Match', '1')
      .send({ investigatorId: investigator.id });

    const secretNote = 'A confidential detail about the injured party.';
    await request(app)
      .post(`/api/v1/incidents/${id}/notes`)
      .set('Authorization', `Bearer ${tokenFor(investigator.id)}`)
      .send({ body: secretNote });

    // The manager has clearance but is not the assignee — Q24: clearance alone is
    // insufficient for notes, and the timeline must reflect exactly the same gate.
    const asManager = await timeline(id, tokenFor(manager.id));
    expect(asManager.status).toBe(200);
    const managerNoteEvt = asManager.body.items.find((e: { type: string }) => e.type === 'NOTE_ADDED');
    expect(managerNoteEvt).toEqual({
      id: managerNoteEvt.id,
      occurredAt: managerNoteEvt.occurredAt,
      type: 'NOTE_ADDED',
      redacted: true,
      actor: null,
      noteId: null,
      length: null,
    });

    const asInvestigator = await timeline(id, tokenFor(investigator.id));
    const investigatorNoteEvt = asInvestigator.body.items.find((e: { type: string }) => e.type === 'NOTE_ADDED');
    expect(investigatorNoteEvt).toMatchObject({ redacted: false, length: secretNote.length });
    expect(investigatorNoteEvt.actor).toMatchObject({ id: investigator.id });
  });

  it('ACCESS_DENIED rows are visible only to ADMIN, never to an actor who otherwise has clearance', async () => {
    // High clearance so this reporter can see their OWN CRITICAL report (Q9) — the
    // point of the test is that clearance alone still isn't enough to see someone
    // ELSE's denial, so the reporter needs to actually clear the incident's own gate.
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 4 });
    const lowClearanceManager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 1 });
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({
        type: 'SAFETY',
        severity: 'CRITICAL',
        title: 'A critical incident above the manager\'s clearance',
        description: 'Description long enough to satisfy validation rules in every test context.',
        noImageReason: 'Test fixture — no photo captured for this scenario.',
      });
    const id: string = created.body.id;

    const denied = await request(app)
      .get(`/api/v1/incidents/${id}`)
      .set('Authorization', `Bearer ${tokenFor(lowClearanceManager.id)}`);
    expect(denied.status).toBe(403);
    await flushPendingDenials();

    const asAdmin = await timeline(id, tokenFor(admin.id));
    expect(asAdmin.body.items.some((e: { type: string }) => e.type === 'ACCESS_DENIED')).toBe(true);

    // The reporter has full clearance for their own CRITICAL report (Q9's visibility,
    // not the manager's denial) but must still never see someone ELSE's refusal.
    const asReporter = await timeline(id, tokenFor(reporter.id));
    expect(asReporter.status).toBe(200);
    expect(asReporter.body.items.some((e: { type: string }) => e.type === 'ACCESS_DENIED')).toBe(false);
  });

  it('a viewer without clearance for the incident gets 403 INSUFFICIENT_CLEARANCE from the timeline itself', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const lowClearanceReporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({
        type: 'SAFETY',
        severity: 'CRITICAL',
        title: 'Another critical incident',
        description: 'Description long enough to satisfy validation rules in every test context.',
        noImageReason: 'Test fixture — no photo captured for this scenario.',
      });
    const id: string = created.body.id;

    const res = await timeline(id, tokenFor(lowClearanceReporter.id));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_CLEARANCE');
  });

  it('an INCIDENT_ESCALATED row (a system event, no actor) maps cleanly with a null actor', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({
        type: 'SAFETY',
        severity: 'HIGH',
        title: 'An escalated incident',
        description: 'Description long enough to satisfy validation rules in every test context.',
        noImageReason: 'Test fixture — no photo captured for this scenario.',
      });
    const id: string = created.body.id;

    await prisma.auditEvent.create({
      data: {
        id: newId(),
        incidentId: id,
        type: 'INCIDENT_ESCALATED',
        fromValue: '0',
        toValue: '1',
        payload: { cycle: 1, level: 1, escalationEventId: newId() },
        occurredAt: new Date(),
      },
    });

    const res = await timeline(id, tokenFor(admin.id));
    const escalated = res.body.items.find((e: { type: string }) => e.type === 'INCIDENT_ESCALATED');
    expect(escalated).toMatchObject({ actor: null, fromLevel: 0, toLevel: 1, cycle: 1 });
  });
});

describe('Module 8 — GET /audit (build-plan.md §13, ADMIN-only global search)', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('a non-admin is refused 403 INSUFFICIENT_ROLE', async () => {
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });

    const res = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${tokenFor(manager.id)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
  });

  it('filters by type and incidentId, and includes rows with no incident (this module has none yet, but the shape must tolerate it)', async () => {
    const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenFor(reporter.id)}`)
      .send({
        type: 'SAFETY',
        severity: 'LOW',
        title: 'Audit search fixture incident',
        description: 'Description long enough to satisfy validation rules in every test context.',
        noImageReason: 'Test fixture — no photo captured for this scenario.',
      });
    const id: string = created.body.id;

    await request(app)
      .post(`/api/v1/incidents/${id}/triage`)
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`)
      .set('If-Match', '0');

    const byType = await request(app)
      .get('/api/v1/audit?type=STAGE_CHANGED')
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(byType.status).toBe(200);
    expect(byType.body.items.every((r: { type: string }) => r.type === 'STAGE_CHANGED')).toBe(true);
    expect(byType.body.items.some((r: { incidentId: string }) => r.incidentId === id)).toBe(true);

    const byIncident = await request(app)
      .get(`/api/v1/audit?incidentId=${id}`)
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(byIncident.body.totalItems).toBe(2); // INCIDENT_CREATED + STAGE_CHANGED
    expect(byIncident.body.items.every((r: { incidentReference: string }) => typeof r.incidentReference === 'string')).toBe(
      true,
    );

    const byActor = await request(app)
      .get(`/api/v1/audit?actorId=${admin.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
    expect(byActor.body.items.every((r: { actor: { id: string } | null }) => r.actor?.id === admin.id)).toBe(true);
  });
});
