import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { createIncident } from '../setup/factories/incidentFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';
import { SeverityValues, type Severity } from '../../src/contracts/enums';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

const HIGH_BAND = new Set<Severity>(['HIGH', 'CRITICAL']);

const ORDERED_PAIRS = SeverityValues.flatMap((from) =>
  SeverityValues.filter((to) => to !== from).map((to) => [from, to] as const),
);

const CASES = ORDERED_PAIRS.flatMap(([from, to]) =>
  [true, false].flatMap((acked) => [true, false].map((assigned) => ({ from, to, acked, assigned }))),
);

/**
 * build-plan.md finding S1, "Done when" row: all 12 ordered severity pairs ×
 * {acknowledged, not} × {assigned, not} through PATCH /severity, asserting no 5xx
 * anywhere and that the high_severity_clock CHECK constraint never fires. The
 * investigator here always holds clearance 4 (the ceiling), so Q17's cascade —
 * already proven separately in triage-actions.spec.ts — never interferes: this sweep
 * isolates applySeverityChange's band-membership logic on its own.
 */
describe('Module 4 — exhaustive severity-change sweep (48 cases)', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it.each(CASES)(
    '$from -> $to (acked=$acked, assigned=$assigned) never 5xxs and the clock stays consistent',
    async ({ from, to, acked, assigned }) => {
      const reporter = await createUser(prisma, { role: 'REPORTER', clearanceLevel: 1 });
      const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });
      const investigator = assigned ? await createUser(prisma, { role: 'INVESTIGATOR', clearanceLevel: 4 }) : null;

      const fromIsHighBand = HIGH_BAND.has(from);
      const incident = await createIncident(prisma, reporter.id, {
        severity: from,
        stage: assigned ? 'INVESTIGATION' : 'TRIAGE',
        assignedInvestigatorId: investigator?.id ?? null,
        acknowledgedAt: acked && fromIsHighBand ? new Date() : null,
        acknowledgedById: acked && fromIsHighBand ? manager.id : null,
      });

      const res = await request(app)
        .patch(`/api/v1/incidents/${incident.id}/severity`)
        .set('Authorization', `Bearer ${tokenFor(manager.id)}`)
        .set('If-Match', '0')
        .send({ severity: to, reason: `sweep ${from} -> ${to}, acked=${acked}, assigned=${assigned}` });

      expect(res.status).toBeLessThan(500);
      expect(res.status).toBe(200);

      const row = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
      expect(row.severity).toBe(to);
      if (HIGH_BAND.has(to)) {
        expect(row.highSeveritySince).not.toBeNull();
      } else {
        expect(row.highSeveritySince).toBeNull();
      }
    },
  );
});
