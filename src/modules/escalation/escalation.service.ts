import { systemClock } from '../../core/time';
import { childLogger } from '../../core/logger';
import { decodeEscalationFeedCursor, encodeEscalationFeedCursor, type CursorPage } from '../../core/pagination';
import type {
  EscalationFeedItem,
  EscalationEventDto,
  EscalationTierDto,
  RunEscalationJobResponse,
} from '../../contracts/escalation.contract';
import type { Actor } from '../../types/actor.type';
import { getByIdForActor } from '../incidents/incident.service';
import { runEscalationJob } from '../../jobs/escalation.job';
import { activeTiers } from './tiers.repository';
import { findActiveEscalationsPage, findCurrentEvents, findEventsForIncident } from './escalation.repository';
import { toEscalationEventDto, toEscalationFeedItem, toEscalationTierDto } from './escalation.mapper';

export async function listTiers(): Promise<EscalationTierDto[]> {
  const tiers = await activeTiers();
  return tiers.map(toEscalationTierDto);
}

export async function listFeed(actor: Actor, cursorRaw: string | undefined, pageSize: number): Promise<CursorPage<EscalationFeedItem>> {
  const cursor = cursorRaw ? decodeEscalationFeedCursor(cursorRaw) : undefined;
  const rows = await findActiveEscalationsPage(actor, cursor, pageSize);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const events = await findCurrentEvents(
    page.map((incident) => ({ incidentId: incident.id, cycle: incident.escalationCycle, level: incident.currentEscalationLevel })),
  );
  const eventByIncidentId = new Map(events.map((e) => [e.incidentId, e]));

  // Soft-skip (never a 500): see escalation.repository.ts::findCurrentEvents — a
  // missing match would only mean the row changed under us between the two queries.
  const items = page.flatMap((incident) => {
    const event = eventByIncidentId.get(incident.id);
    return event ? [toEscalationFeedItem(incident, event)] : [];
  });

  const last = page[page.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeEscalationFeedCursor(last.currentEscalationLevel, last.highSeveritySince, last.id) : null,
  };
}

/**
 * Same population as the incident detail's own `escalation` field (§8.1's mapper
 * table, incident.mapper.ts::canSeeEscalation) — gated at the router level via
 * authorizeRole('TRIAGE_MANAGER','ADMIN'); getByIdForActor here is what still turns a
 * clearance-2 manager's request into a 403 (not the incident data) before a 404 even
 * gets considered, exactly like every other Module 4-6 sub-resource.
 */
export async function listEventsForIncident(actor: Actor, incidentId: string): Promise<EscalationEventDto[]> {
  await getByIdForActor(actor, incidentId);
  const events = await findEventsForIncident(incidentId);
  return events.map(toEscalationEventDto);
}

const jobLogger = childLogger({ module: 'escalation-job-manual-trigger' });

/** POST /jobs/escalation/run (admin) — the walkthrough's live double-run demo (S7: registered once, here). */
export async function runNow(): Promise<RunEscalationJobResponse> {
  return runEscalationJob({ clock: systemClock, logger: jobLogger });
}
