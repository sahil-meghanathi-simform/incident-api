import { z } from 'zod';
import { IncidentTypeSchema, SeveritySchema, StageSchema } from './enums';
import { booleanQueryParam, csvArrayQueryParam, offsetEnvelopeSchema, offsetQuerySchema } from './pagination.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

// .strict() rejects a `reporterId` or `stage` in the body with 422 rather than
// silently dropping it — reporterId always comes from req.actor.id and stage is
// always REPORTED, neither is ever client-supplied (§7.1 business rules).
export const CreateIncidentRequestSchema = z
  .object({
    type: IncidentTypeSchema,
    severity: SeveritySchema,
    title: z.string().trim().min(5).max(160),
    description: z.string().trim().min(20).max(5000),
  })
  .strict();
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequestSchema>;

// Q9: the receipt is deliberately NOT the incident. `visibleToYou` only tells the
// frontend whether to offer a "view incident" link — the server refuses the read
// regardless of what this flag says (getByIdForActor re-checks clearance itself).
export const IncidentReceiptSchema = z.object({
  id: z.string(),
  reference: z.string(),
  createdAt: z.string(),
  severity: SeveritySchema,
  visibleToYou: z.boolean(),
});
export type IncidentReceipt = z.infer<typeof IncidentReceiptSchema>;

export const IncidentTypeOptionSchema = z.object({ value: IncidentTypeSchema, label: z.string() });
export type IncidentTypeOption = z.infer<typeof IncidentTypeOptionSchema>;

export const SeverityOptionSchema = z.object({ value: SeveritySchema, label: z.string() });
export type SeverityOption = z.infer<typeof SeverityOptionSchema>;

export const IncidentTypesResponseSchema = z.object({
  types: z.array(IncidentTypeOptionSchema),
  severities: z.array(SeverityOptionSchema),
});
export type IncidentTypesResponse = z.infer<typeof IncidentTypesResponseSchema>;

// ---------------------------------------------------------------------------
// Module 3 — Read & Visibility
// ---------------------------------------------------------------------------

// Any future :id-shaped route relies on this rejecting a malformed id with 422
// at the validation layer rather than falling through to a confusing 404 (S7).
export const IncidentIdParamsSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{20,32}$/i, 'must be a valid incident id'),
  })
  .strict();
export type IncidentIdParams = z.infer<typeof IncidentIdParamsSchema>;

const IsoDateStringSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'must be a valid date');

export const ListIncidentsQuerySchema = offsetQuerySchema
  .extend({
    severity: csvArrayQueryParam(SeveritySchema),
    stage: csvArrayQueryParam(StageSchema),
    type: csvArrayQueryParam(IncidentTypeSchema),
    assignedToMe: booleanQueryParam(),
    reportedByMe: booleanQueryParam(),
    unacknowledged: booleanQueryParam(),
    escalatedOnly: booleanQueryParam(),
    from: IsoDateStringSchema.optional(),
    to: IsoDateStringSchema.optional(),
    q: z.string().trim().max(120).optional(),
    sort: z.enum(['createdAt', 'severity', 'updatedAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuerySchema>;

const UserRefSchema = z.object({ id: z.string(), displayName: z.string() });

export const IncidentListItemSchema = z.object({
  id: z.string(),
  reference: z.string(),
  type: IncidentTypeSchema,
  severity: SeveritySchema,
  stage: StageSchema,
  title: z.string(),
  assignedInvestigator: UserRefSchema.nullable(),
  acknowledgedAt: z.string().nullable(),
  currentEscalationLevel: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IncidentListItem = z.infer<typeof IncidentListItemSchema>;

export const IncidentListResponseSchema = offsetEnvelopeSchema(IncidentListItemSchema);
export type IncidentListResponse = z.infer<typeof IncidentListResponseSchema>;

// A hint for the UI, never authority — every action endpoint re-checks server-side.
export const IncidentActionsSchema = z.object({
  canTriage: z.boolean(),
  canAssign: z.boolean(),
  canAcknowledge: z.boolean(),
  canReadNotes: z.boolean(),
  canAddNote: z.boolean(),
  canProposeClosure: z.boolean(),
  canApproveClosure: z.boolean(),
});
export type IncidentActions = z.infer<typeof IncidentActionsSchema>;

export const IncidentAcknowledgementSchema = z.object({
  acknowledgedAt: z.string(),
  acknowledgedBy: UserRefSchema.nullable(),
});

export const IncidentEscalationSchema = z.object({
  currentEscalationLevel: z.number().int(),
  highSeveritySince: z.string().nullable(),
  lastEscalatedAt: z.string().nullable(),
});

// Module 6: null until CLOSED. Same visibility rule as rootCause/correctiveAction —
// exposed to anyone who passed the clearance gate, never gated behind canSeeAssignment
// the way assignedInvestigator/acknowledgement/escalation are, since who closed an
// incident and when is part of the closure record, not an investigation detail.
export const IncidentClosureSchema = z.object({
  closedAt: z.string(),
  closedBy: UserRefSchema.nullable(),
});

// assignedInvestigator/acknowledgement/escalation are OMITTED (not merely null) for a
// viewer not entitled to them — Triage/Admin/the assignee only (§8.1 mapper table).
// rootCause/correctiveAction are exposed to anyone who passed the clearance gate: they
// are the closure record, not an investigation detail. Notes are never inlined here —
// a separate, doubly-gated endpoint in Module 5 (Q24).
export const IncidentDetailSchema = z.object({
  id: z.string(),
  reference: z.string(),
  type: IncidentTypeSchema,
  severity: SeveritySchema,
  stage: StageSchema,
  title: z.string(),
  description: z.string(),
  reporter: UserRefSchema,
  assignedInvestigator: UserRefSchema.nullable().optional(),
  rootCause: z.string().nullable(),
  correctiveAction: z.string().nullable(),
  closure: IncidentClosureSchema.nullable(),
  acknowledgement: IncidentAcknowledgementSchema.nullable().optional(),
  escalation: IncidentEscalationSchema.optional(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  _actions: IncidentActionsSchema,
});
export type IncidentDetail = z.infer<typeof IncidentDetailSchema>;

export const IncidentSummarySchema = z.object({
  counts: z.record(StageSchema, z.number().int()),
});
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;

export const MineQuerySchema = offsetQuerySchema.strict();
export type MineQuery = z.infer<typeof MineQuerySchema>;
