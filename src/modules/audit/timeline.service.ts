import { decodeOccurredAtIdCursor, encodeOccurredAtIdCursor, type CursorPage } from '../../core/pagination';
import { canReadNotes } from '../../policy/note.policy';
import type { Actor } from '../../types/actor.type';
import type { TimelineEvent } from '../../contracts/audit.contract';
import { getByIdForActor } from '../incidents/incident.service';
import { toTimelineEvent } from './audit.mapper';
import { findTimelinePage, findUserRefsByIds } from './audit.repository';

/**
 * Kept OUT of audit.service.ts on purpose: this function needs
 * incidents/incident.service.ts::getByIdForActor for the clearance gate, and
 * incident.service.ts already imports audit.service.ts (for record/recordDenial) — a
 * second import back the other way would be a real module cycle, not just a lint
 * nit. `escalation.service.ts`/`notification.service.ts` split the same way for the
 * same reason (two services, one module directory).
 *
 * Read side of build-plan.md's Module 8: `getByIdForActor` makes the SAME
 * clearance-gated authorization decision every other incident read uses (403
 * INSUFFICIENT_CLEARANCE / 404, never a third code path); `canReadNotes` reuses
 * Module 5's exact two-gate function to decide whether THIS actor gets the full
 * NOTE_ADDED payload or the redacted stub; ACCESS_DENIED rows are excluded from the
 * query entirely for anyone but ADMIN (audit.repository.ts::findTimelinePage), never
 * filtered after the fact, so a non-admin's page size is never silently short.
 */
export async function timeline(
  actor: Actor,
  incidentId: string,
  cursorRaw: string | undefined,
  pageSize: number,
): Promise<CursorPage<TimelineEvent>> {
  const incident = await getByIdForActor(actor, incidentId);
  const canSeeNotes = canReadNotes(actor, incident);

  const cursor = cursorRaw ? decodeOccurredAtIdCursor(cursorRaw) : undefined;
  const rows = await findTimelinePage(incidentId, cursor, pageSize, actor.role === 'ADMIN');
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const userIds = new Set<string>();
  for (const row of page) {
    if (row.type === 'INVESTIGATOR_ASSIGNED' && row.toValue) userIds.add(row.toValue);
    if (row.type === 'INVESTIGATOR_UNASSIGNED' && row.fromValue) userIds.add(row.fromValue);
  }
  const userRefs = new Map((await findUserRefsByIds([...userIds])).map((u) => [u.id, u]));

  const last = page[page.length - 1];
  return {
    items: page.map((row) => toTimelineEvent(row, canSeeNotes, userRefs)),
    hasMore,
    nextCursor: hasMore && last ? encodeOccurredAtIdCursor(last.occurredAt, last.id) : null,
  };
}
