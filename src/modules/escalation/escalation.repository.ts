import { prisma } from '../../db/prisma';
import { findActiveEscalationsPage } from '../incidents/incident.repository';

export { findActiveEscalationsPage };
export type { EscalationFeedIncidentRow } from '../incidents/incident.repository';

export interface CurrentEventKey {
  incidentId: string;
  cycle: number;
  level: number;
}

export interface CurrentEventRow {
  incidentId: string;
  cycle: number;
  level: number;
  dueAt: Date;
  triggeredAt: Date;
}

/**
 * Exact (incidentId, cycle, level) tuple lookup against the unique index — the second
 * half of the feed's two-query design. Correct by construction: currentEscalationLevel
 * is only ever set, in the same transaction as the matching EscalationEvent insert, by
 * escalation.job.ts — so for any row activeEscalationWhere returns, a matching event
 * always exists (the seed deliberately never sets currentEscalationLevel > 0 without
 * one either — prisma/seed/incidents.seed.ts).
 */
export async function findCurrentEvents(keys: CurrentEventKey[]): Promise<CurrentEventRow[]> {
  if (keys.length === 0) return [];
  return prisma.escalationEvent.findMany({
    where: { OR: keys.map((k) => ({ incidentId: k.incidentId, cycle: k.cycle, level: k.level })) },
    select: { incidentId: true, cycle: true, level: true, dueAt: true, triggeredAt: true },
  });
}

/**
 * Full tier-by-tier history for one incident. No clearance/role filter here — the
 * caller (escalation.service.ts::listEventsForIncident) has already run getByIdForActor
 * plus the same canManage(actor) check the incident detail mapper uses for its own
 * `escalation` field, so by the time this runs the incident is already proven visible.
 */
export function findEventsForIncident(incidentId: string) {
  return prisma.escalationEvent.findMany({
    where: { incidentId },
    orderBy: [{ level: 'asc' }, { triggeredAt: 'asc' }],
    select: { id: true, cycle: true, level: true, dueAt: true, triggeredAt: true },
  });
}
