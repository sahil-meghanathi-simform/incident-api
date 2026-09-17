import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../src/app';
import { truncateAll } from '../setup/truncate';
import { createUser } from '../setup/factories/userFactory';
import { createIncident } from '../setup/factories/incidentFactory';
import { createEscalationEvent, createNotification } from '../setup/factories/escalationFactory';
import { signAccessToken } from '../../src/modules/auth/token.service';
import { newId } from '../../src/core/ids';

const prisma = new PrismaClient();
const app = createApp();

function tokenFor(userId: string): string {
  return signAccessToken({ sub: userId, sid: newId() });
}

/**
 * build-plan.md S2: escalations and notifications are incident reads that must go
 * through the same visibilityScope as every other incident read — the reference plan
 * role-gated GET /escalations to TRIAGE_MANAGER/ADMIN and said nothing about clearance,
 * so a clearance-2 manager could see CRITICAL references, levels and overdue times in
 * the feed, and kept being served NotificationLog rows for an incident an admin had
 * since lowered them below.
 */
describe('S2 — escalation feed and notifications are clearance-scoped, not just role-scoped', () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('a clearance-2 manager sees no CRITICAL escalation in the feed and gets no notification for it', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const lowClearanceManager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 2 });

    const critical = await createIncident(prisma, admin.id, { severity: 'CRITICAL', currentEscalationLevel: 1 });
    const event = await createEscalationEvent(prisma, critical.id, { cycle: 1, level: 1, severityAtEscalation: 'CRITICAL' });
    await createNotification(prisma, event.id, lowClearanceManager.id);

    const feedRes = await request(app)
      .get('/api/v1/escalations')
      .set('Authorization', `Bearer ${tokenFor(lowClearanceManager.id)}`);
    expect(feedRes.status).toBe(200);
    expect(feedRes.body.items).toEqual([]);

    const notificationsRes = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenFor(lowClearanceManager.id)}`);
    expect(notificationsRes.status).toBe(200);
    expect(notificationsRes.body.items).toEqual([]);
    expect(notificationsRes.body.unreadCount).toBe(0);
  });

  it('a notification earned at clearance 4 disappears from the list once clearance is lowered to 2', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', clearanceLevel: 4 });
    const manager = await createUser(prisma, { role: 'TRIAGE_MANAGER', clearanceLevel: 4 });

    const critical = await createIncident(prisma, admin.id, { severity: 'CRITICAL', currentEscalationLevel: 1 });
    const event = await createEscalationEvent(prisma, critical.id, { cycle: 1, level: 1, severityAtEscalation: 'CRITICAL' });
    await createNotification(prisma, event.id, manager.id);

    const before = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(before.body.items).toHaveLength(1);
    expect(before.body.unreadCount).toBe(1);

    await prisma.user.update({ where: { id: manager.id }, data: { clearanceLevel: 2 } });

    const after = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${tokenFor(manager.id)}`);
    expect(after.body.items).toEqual([]);
    expect(after.body.unreadCount).toBe(0);
  });
});
