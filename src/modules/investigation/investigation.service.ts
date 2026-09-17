import { newId } from '../../core/ids';
import { withTransaction } from '../../db/transaction';
import { buildOffsetPage, decodeCreatedAtIdCursor, encodeCreatedAtIdCursor, type CursorPage } from '../../core/pagination';
import { canReadNotes, canWriteNotes } from '../../policy/note.policy';
import { NotAssignedInvestigatorError, NotesClosedError } from '../../core/errors/domain-errors';
import type { InvestigationNote } from '../../contracts/investigation.contract';
import type { IncidentListResponse } from '../../contracts/incident.contract';
import type { Actor } from '../../types/actor.type';
import * as auditService from '../audit/audit.service';
import { getByIdForActor } from '../incidents/incident.service';
import { toIncidentListItem } from '../incidents/incident.mapper';
import { findMyInvestigationsPage } from '../incidents/incident.repository';
import { createNote, findNotesPage } from './investigation.repository';
import { toInvestigationNote } from './investigation.mapper';

/**
 * Gate 1 (clearance) is already enforced by getByIdForActor, which 403s
 * INSUFFICIENT_CLEARANCE / 404s before this ever runs. Gate 2 (assignment) is the one
 * this function adds — a visible-but-not-yours incident must read as 403
 * NOT_ASSIGNED_INVESTIGATOR, a distinct, more useful message than a bare clearance
 * refusal (§10.1).
 */
async function assertReadAccess(actor: Actor, incidentId: string) {
  const incident = await getByIdForActor(actor, incidentId);
  if (!canReadNotes(actor, incident)) throw new NotAssignedInvestigatorError(incidentId);
  return incident;
}

export async function listNotes(
  actor: Actor,
  incidentId: string,
  cursorRaw: string | undefined,
  pageSize: number,
): Promise<CursorPage<InvestigationNote>> {
  await assertReadAccess(actor, incidentId);

  const cursor = cursorRaw ? decodeCreatedAtIdCursor(cursorRaw) : undefined;
  const rows = await findNotesPage(actor, incidentId, cursor, pageSize);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toInvestigationNote),
    hasMore,
    nextCursor: hasMore && last ? encodeCreatedAtIdCursor(last.createdAt, last.id) : null,
  };
}

/**
 * §10.1: creates the note and its NOTE_ADDED audit row in one transaction. The audit
 * payload stores only `{ noteId, length }` — never the body, or the Module 8 timeline
 * would leak a note to viewers who never passed the two-gate rule.
 */
export async function addNote(actor: Actor, incidentId: string, body: string): Promise<InvestigationNote> {
  const incident = await assertReadAccess(actor, incidentId);
  if (!canWriteNotes(actor, incident)) throw new NotesClosedError(incident.stage);

  const now = new Date();
  const noteId = newId();

  const created = await withTransaction(async (tx) => {
    const note = await createNote({ id: noteId, incidentId, authorId: actor.id, body, createdAt: now }, tx);
    await auditService.record(tx, {
      incidentId,
      actorId: actor.id,
      type: 'NOTE_ADDED',
      payload: { noteId: note.id, length: body.length },
      occurredAt: now,
    });
    return note;
  });

  return toInvestigationNote(created);
}

export async function myInvestigations(actor: Actor, page: number, pageSize: number): Promise<IncidentListResponse> {
  const { items, totalItems } = await findMyInvestigationsPage(actor, page, pageSize);
  return buildOffsetPage(items.map(toIncidentListItem), totalItems, page, pageSize);
}
