import { z } from 'zod';
import { offsetEnvelopeSchema, offsetQuerySchema } from './pagination.contract';
import { IncidentDetailSchema, IncidentListItemSchema } from './incident.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

// Gate 1 of the four-layer closure defence (§2.4): a refinement (trim then min(20)), so
// whitespace-only text cannot satisfy the length check — same S6 lesson enforced again
// at gate 3 (the service re-read) and gate 4 (the closed_requires_rca CHECK).
export const ProposeClosureRequestSchema = z
  .object({
    rootCause: z.string().trim().min(20, 'root cause must be at least 20 characters').max(4000),
    correctiveAction: z.string().trim().min(20, 'corrective action must be at least 20 characters').max(4000),
  })
  .strict();
export type ProposeClosureRequest = z.infer<typeof ProposeClosureRequestSchema>;

// Gate 2: the approve endpoint accepts NO body keys at all — .strict() on an empty
// shape rejects any smuggled rootCause/correctiveAction with 422, before gate 3 (the
// service's own re-read of the DATABASE row) ever runs.
export const ApproveClosureRequestSchema = z.object({}).strict();
export type ApproveClosureRequest = z.infer<typeof ApproveClosureRequestSchema>;

export const RejectClosureRequestSchema = z
  .object({
    reason: z.string().trim().min(10, 'reason must be at least 10 characters').max(1000),
  })
  .strict();
export type RejectClosureRequest = z.infer<typeof RejectClosureRequestSchema>;

// Same shape as every Module 4 mutation response (§2.8): the fresh version for the
// next If-Match and the recomputed _actions hint in one round trip.
export const ClosureActionResponseSchema = IncidentDetailSchema;
export type ClosureActionResponse = z.infer<typeof ClosureActionResponseSchema>;

export const ClosuresPendingQuerySchema = offsetQuerySchema.strict();
export type ClosuresPendingQuery = z.infer<typeof ClosuresPendingQuerySchema>;

// A manager's approval queue is still an incident list — the frontend's existing
// list table already knows how to render an IncidentListItem.
export const ClosuresPendingResponseSchema = offsetEnvelopeSchema(IncidentListItemSchema);
export type ClosuresPendingResponse = z.infer<typeof ClosuresPendingResponseSchema>;
