import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import type { TxClient } from '../../db/transaction';
import { createdAtIdCursorWhere } from '../../core/pagination';
import { visibilityScope } from '../../policy/clearance.policy';
import type { Actor } from '../../types/actor.type';
import { USER_REF_SELECT } from '../incidents/incident.repository';

export const NOTE_INCLUDE = {
  author: { select: USER_REF_SELECT },
} satisfies Prisma.InvestigationNoteInclude;

export type NoteRow = Prisma.InvestigationNoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

/**
 * Both gates of the two-gate rule (docs/authorization.md, "walkthrough question 2"),
 * expressed again here on the related incident — clearance via visibilityScope, and
 * assignment via `assignedInvestigatorId = actor.id` unless the actor is ADMIN. A
 * wrong actor gets zero rows even if investigation.service.ts's own check were ever
 * bypassed. Composed via AND (not spread) alongside the cursor's own OR, per the S4
 * discipline in incident.repository.ts::buildWhere — nothing here collides with it
 * today, but nothing will if a text filter is ever added to this endpoint either.
 */
function noteScopeWhere(actor: Actor, incidentId: string): Prisma.InvestigationNoteWhereInput {
  return {
    AND: [
      { incidentId },
      {
        incident: {
          AND: [visibilityScope(actor), ...(actor.role === 'ADMIN' ? [] : [{ assignedInvestigatorId: actor.id }])],
        },
      },
    ],
  };
}

export async function findNotesPage(
  actor: Actor,
  incidentId: string,
  cursor: { createdAt: Date; id: string } | undefined,
  pageSize: number,
): Promise<NoteRow[]> {
  const where: Prisma.InvestigationNoteWhereInput = {
    AND: [noteScopeWhere(actor, incidentId), ...(cursor ? [createdAtIdCursorWhere(cursor.createdAt, cursor.id)] : [])],
  };
  return prisma.investigationNote.findMany({
    where,
    include: NOTE_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
  });
}

export interface CreateNoteInput {
  id: string;
  incidentId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export function createNote(input: CreateNoteInput, tx: TxClient): Promise<NoteRow> {
  return tx.investigationNote.create({
    data: {
      id: input.id,
      incidentId: input.incidentId,
      authorId: input.authorId,
      body: input.body,
      createdAt: input.createdAt,
    },
    include: NOTE_INCLUDE,
  });
}
