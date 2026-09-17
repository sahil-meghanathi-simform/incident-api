import type { PrismaClient, Severity } from '@prisma/client';
import { newId } from '../../../src/core/ids';

/**
 * Mirrors escalation.job.ts's own INSERT exactly — the real job always writes an
 * EscalationEvent in the same transaction it bumps Incident.currentEscalationLevel, so
 * a test that sets currentEscalationLevel via incidentFactory must also create the
 * matching event here, or the feed's two-query design has nothing to join against.
 */
export async function createEscalationEvent(
  prisma: PrismaClient,
  incidentId: string,
  overrides: Partial<{ cycle: number; level: number; severityAtEscalation: Severity; dueAt: Date; triggeredAt: Date }> = {},
) {
  const now = overrides.triggeredAt ?? new Date();
  return prisma.escalationEvent.create({
    data: {
      id: newId(),
      incidentId,
      cycle: overrides.cycle ?? 1,
      level: overrides.level ?? 1,
      severityAtEscalation: overrides.severityAtEscalation ?? 'HIGH',
      dueAt: overrides.dueAt ?? now,
      triggeredAt: now,
    },
  });
}

export async function createNotification(
  prisma: PrismaClient,
  escalationEventId: string,
  recipientId: string,
  overrides: Partial<{ readAt: Date | null; createdAt: Date }> = {},
) {
  return prisma.notificationLog.create({
    data: {
      id: newId(),
      escalationEventId,
      recipientId,
      readAt: overrides.readAt ?? null,
      createdAt: overrides.createdAt ?? new Date(),
    },
  });
}
