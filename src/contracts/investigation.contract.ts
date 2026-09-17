import { z } from 'zod';
import { cursorEnvelopeSchema, cursorQuerySchema, offsetEnvelopeSchema, offsetQuerySchema } from './pagination.contract';
import { IncidentListItemSchema } from './incident.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

// A refinement (not just `.min(5)`) is required so a note of only whitespace cannot
// satisfy the length check — same lesson as build-plan.md S6.
export const AddNoteRequestSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(5, 'note must be at least 5 characters')
      .max(4000),
  })
  .strict();
export type AddNoteRequest = z.infer<typeof AddNoteRequestSchema>;

const UserRefSchema = z.object({ id: z.string(), displayName: z.string() });

export const InvestigationNoteSchema = z.object({
  id: z.string(),
  incidentId: z.string(),
  author: UserRefSchema,
  body: z.string(),
  createdAt: z.string(),
});
export type InvestigationNote = z.infer<typeof InvestigationNoteSchema>;

export const NotesCursorQuerySchema = cursorQuerySchema.strict();
export type NotesCursorQuery = z.infer<typeof NotesCursorQuerySchema>;

export const NotesPageResponseSchema = cursorEnvelopeSchema(InvestigationNoteSchema);
export type NotesPageResponse = z.infer<typeof NotesPageResponseSchema>;

export const MyInvestigationsQuerySchema = offsetQuerySchema.strict();
export type MyInvestigationsQuery = z.infer<typeof MyInvestigationsQuerySchema>;

// Same shape as GET /incidents — an assigned incident is still an incident, and the
// frontend queue table already knows how to render an IncidentListItem.
export const MyInvestigationsResponseSchema = offsetEnvelopeSchema(IncidentListItemSchema);
export type MyInvestigationsResponse = z.infer<typeof MyInvestigationsResponseSchema>;
