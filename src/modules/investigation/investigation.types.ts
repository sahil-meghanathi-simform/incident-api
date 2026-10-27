import type { Prisma } from '@prisma/client';
import type { NOTE_INCLUDE } from './investigation.repository';

export type NoteRow = Prisma.InvestigationNoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

export interface CreateNoteInput {
  id: string;
  incidentId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}
