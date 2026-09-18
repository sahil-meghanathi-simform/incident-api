import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma as appPrisma } from '../../src/db/prisma';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { createIncident } from '../setup/factories/incidentFactory';
import { createEscalationEvent } from '../setup/factories/escalationFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

const PERIOD = { from: '2026-03-01', to: '2026-03-31' };

describe('Module 9 — Reporting & Analytics', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  describe('period validation', () => {
    it('401s with no token', async () => {
      const res = await request(app).get('/api/v1/analytics/overview').query(PERIOD);
      expect(res.status).toBe(401);
    });

    it('422s when from or to is missing', async () => {
      const user = await createUser(prisma);
      const token = tokenFor(user.id);
      const missingFrom = await request(app).get('/api/v1/analytics/overview').query({ to: PERIOD.to }).set('Authorization', `Bearer ${token}`);
      expect(missingFrom.status).toBe(422);
      const missingTo = await request(app).get('/api/v1/analytics/overview').query({ from: PERIOD.from }).set('Authorization', `Bearer ${token}`);
      expect(missingTo.status).toBe(422);
    });

    it('422s when the range exceeds 366 days', async () => {
      const user = await createUser(prisma);
      const token = tokenFor(user.id);
      const res = await request(app)
        .get('/api/v1/analytics/by-type-severity')
        .query({ from: '2025-01-01', to: '2026-02-05' }) // > 366 days
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(422);
    });

    it('422s when to is before from', async () => {
      const user = await createUser(prisma);
      const token = tokenFor(user.id);
      const res = await request(app)
        .get('/api/v1/analytics/trend')
        .query({ from: '2026-03-31', to: '2026-03-01' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(422);
    });
  });

  describe('by-type-severity matrix', () => {
    it('zero-fills every (type, severity) cell this actor may see, and totals match an independent count()', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
      const token = tokenFor(admin.id);
      const inRange = new Date('2026-03-15T12:00:00.000Z');
      await createIncident(prisma, admin.id, { type: 'SAFETY', severity: 'LOW', createdAt: inRange });
      await createIncident(prisma, admin.id, { type: 'SAFETY', severity: 'LOW', createdAt: inRange });
      await createIncident(prisma, admin.id, { type: 'SECURITY', severity: 'CRITICAL', createdAt: inRange });
      // Outside the period — must not be counted.
      await createIncident(prisma, admin.id, { type: 'SAFETY', severity: 'LOW', createdAt: new Date('2026-04-15T00:00:00.000Z') });

      const res = await request(app).get('/api/v1/analytics/by-type-severity').query(PERIOD).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.severities).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
      // 7 types x 4 severities, every combination present even with zero incidents.
      expect(res.body.cells).toHaveLength(28);
      const safetyLow = res.body.cells.find((c: { type: string; severity: string }) => c.type === 'SAFETY' && c.severity === 'LOW');
      expect(safetyLow.count).toBe(2);
      const safetyMedium = res.body.cells.find((c: { type: string; severity: string }) => c.type === 'SAFETY' && c.severity === 'MEDIUM');
      expect(safetyMedium.count).toBe(0);
      expect(res.body.grandTotal).toBe(3);

      const crossCheck = await appPrisma.incident.count({
        where: { createdAt: { gte: new Date('2026-03-01'), lt: new Date('2026-04-01') } },
      });
      expect(crossCheck).toBe(res.body.grandTotal);
    });

    it('a clearance-2 actor never sees a HIGH/CRITICAL column — omitted, not a fabricated zero', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
      const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });
      await createIncident(prisma, admin.id, { type: 'SAFETY', severity: 'CRITICAL', createdAt: new Date('2026-03-15T00:00:00.000Z') });

      const res = await request(app)
        .get('/api/v1/analytics/by-type-severity')
        .query(PERIOD)
        .set('Authorization', `Bearer ${tokenFor(manager.id)}`);
      expect(res.body.severities).toEqual(['LOW', 'MEDIUM']);
      expect(res.body.cells).toHaveLength(14);
      expect(res.body.grandTotal).toBe(0);
    });

    it('clearance-2 and clearance-4 actors get different, individually correct totals for the same period', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
      const manager2 = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });
      const manager4 = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
      await createIncident(prisma, admin.id, { severity: 'LOW', createdAt: new Date('2026-03-10T00:00:00.000Z') });
      await createIncident(prisma, admin.id, { severity: 'CRITICAL', createdAt: new Date('2026-03-10T00:00:00.000Z') });

      const res2 = await request(app).get('/api/v1/analytics/overview').query(PERIOD).set('Authorization', `Bearer ${tokenFor(manager2.id)}`);
      const res4 = await request(app).get('/api/v1/analytics/overview').query(PERIOD).set('Authorization', `Bearer ${tokenFor(manager4.id)}`);
      expect(res2.body.totalIncidents).toBe(1);
      expect(res4.body.totalIncidents).toBe(2);
    });

    it('issues exactly one query against Incident (guards a future N+1)', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });

      // Real query-event listening rather than mocking Prisma's internals (this
      // codebase never mocks the DB — see tests/setup/globalSetup.ts). db/prisma.ts
      // emits 'query' events in the 'test' env for exactly this purpose.
      const queries: string[] = [];
      const onQuery = (e: { query: string }) => queries.push(e.query);
      appPrisma.$on('query' as never, onQuery as never);

      const res = await request(app).get('/api/v1/analytics/by-type-severity').query(PERIOD).set('Authorization', `Bearer ${tokenFor(admin.id)}`);
      expect(res.status).toBe(200);

      const incidentQueries = queries.filter((q) => q.includes('"Incident"'));
      expect(incidentQueries).toHaveLength(1);
      expect(incidentQueries[0]).toContain('GROUP BY');
    });
  });

  describe('S4 — the matrix (Prisma) and the trend (raw SQL) paths agree at the period boundary', () => {
    it('an incident created exactly at the exclusive `to` instant is excluded by BOTH paths, and included by both once `to` moves 1ms later', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
      const token = tokenFor(admin.id);
      const to = '2026-03-15T10:00:00.000Z';
      await createIncident(prisma, admin.id, { severity: 'LOW', createdAt: new Date(to) });

      const matrixExcl = await request(app)
        .get('/api/v1/analytics/by-type-severity')
        .query({ from: '2026-03-01T00:00:00.000Z', to })
        .set('Authorization', `Bearer ${token}`);
      const trendExcl = await request(app)
        .get('/api/v1/analytics/trend')
        .query({ from: '2026-03-01T00:00:00.000Z', to })
        .set('Authorization', `Bearer ${token}`);
      expect(matrixExcl.body.grandTotal).toBe(0);
      expect(trendExcl.body.points).toEqual([]);

      const toPlus1ms = '2026-03-15T10:00:00.001Z';
      const matrixIncl = await request(app)
        .get('/api/v1/analytics/by-type-severity')
        .query({ from: '2026-03-01T00:00:00.000Z', to: toPlus1ms })
        .set('Authorization', `Bearer ${token}`);
      const trendIncl = await request(app)
        .get('/api/v1/analytics/trend')
        .query({ from: '2026-03-01T00:00:00.000Z', to: toPlus1ms })
        .set('Authorization', `Bearer ${token}`);
      expect(matrixIncl.body.grandTotal).toBe(1);
      expect(trendIncl.body.points.reduce((sum: number, p: { count: number }) => sum + p.count, 0)).toBe(1);
    });
  });

  describe('escalation-performance', () => {
    it('is role-gated to TRIAGE_MANAGER/ADMIN', async () => {
      const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
      const res = await request(app)
        .get('/api/v1/analytics/escalation-performance')
        .query(PERIOD)
        .set('Authorization', `Bearer ${tokenFor(reporter.id)}`);
      expect(res.status).toBe(403);
    });

    it('S2: a clearance-2 manager sees no row reflecting a CRITICAL incident\'s ack time', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
      const manager2 = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });
      const manager4 = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });

      const triggeredAt = new Date('2026-03-10T00:00:00.000Z');
      const acknowledgedAt = new Date('2026-03-10T01:00:00.000Z'); // 3600s later
      const critical = await createIncident(prisma, admin.id, {
        severity: 'CRITICAL',
        createdAt: triggeredAt,
        acknowledgedAt,
        acknowledgedById: admin.id,
      });
      await createEscalationEvent(prisma, critical.id, { cycle: 1, level: 1, severityAtEscalation: 'CRITICAL', triggeredAt });

      const res2 = await request(app)
        .get('/api/v1/analytics/escalation-performance')
        .query(PERIOD)
        .set('Authorization', `Bearer ${tokenFor(manager2.id)}`);
      expect(res2.body.bySeverity.find((r: { severity: string }) => r.severity === 'CRITICAL')).toBeUndefined();

      const res4 = await request(app)
        .get('/api/v1/analytics/escalation-performance')
        .query(PERIOD)
        .set('Authorization', `Bearer ${tokenFor(manager4.id)}`);
      const criticalRow = res4.body.bySeverity.find((r: { severity: string }) => r.severity === 'CRITICAL');
      expect(criticalRow.escalatedCount).toBe(1);
      expect(criticalRow.acknowledgedCount).toBe(1);
      expect(criticalRow.medianAckSeconds).toBe(3600);
    });
  });

  describe('export.csv', () => {
    it('returns a CSV attachment matching the matrix data', async () => {
      const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
      await createIncident(prisma, admin.id, { type: 'SAFETY', severity: 'LOW', createdAt: new Date('2026-03-05T00:00:00.000Z') });

      const res = await request(app)
        .get('/api/v1/analytics/export.csv')
        .query(PERIOD)
        .set('Authorization', `Bearer ${tokenFor(admin.id)}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text).toContain('Type,Severity,Count');
      expect(res.text).toContain('SAFETY,LOW,1');
      expect(res.text).toContain('TOTAL,,1');
    });
  });
});
