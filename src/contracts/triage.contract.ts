import { z } from 'zod';
import { SeveritySchema } from './enums';
import { offsetEnvelopeSchema, offsetQuerySchema } from './pagination.contract';
import { IncidentListItemSchema, IncidentDetailSchema } from './incident.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

// A refinement (not just `.min(10)`) is required so a reason of only whitespace cannot
// satisfy the length check — mirrors the closure-gate lesson from build-plan.md S6.
export const ChangeSeverityRequestSchema = z
  .object({
    severity: SeveritySchema,
    reason: z
      .string()
      .trim()
      .min(10, 'reason must be at least 10 characters')
      .max(500),
  })
  .strict();
export type ChangeSeverityRequest = z.infer<typeof ChangeSeverityRequestSchema>;

export const AssignInvestigatorRequestSchema = z
  .object({
    investigatorId: z.string().regex(/^[a-z0-9]{20,32}$/i, 'must be a valid user id'),
  })
  .strict();
export type AssignInvestigatorRequest = z.infer<typeof AssignInvestigatorRequestSchema>;

export const TriageQueueQuerySchema = offsetQuerySchema.strict();
export type TriageQueueQuery = z.infer<typeof TriageQueueQuerySchema>;

export const TriageQueueResponseSchema = offsetEnvelopeSchema(IncidentListItemSchema);
export type TriageQueueResponse = z.infer<typeof TriageQueueResponseSchema>;

// Every Module 4 mutation returns the same shape as GET /incidents/:id — the caller
// gets the fresh `version` for its next If-Match and the recomputed `_actions` hint in
// one round trip, rather than a bespoke per-action DTO it would have to reconcile.
export const TriageActionResponseSchema = IncidentDetailSchema;
export type TriageActionResponse = z.infer<typeof TriageActionResponseSchema>;
