import type { InvestigationNote } from '../../contracts/investigation.contract';
import type { NoteRow } from './investigation.types';

export function toInvestigationNote(row: NoteRow): InvestigationNote {
  return {
    id: row.id,
    incidentId: row.incidentId,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
