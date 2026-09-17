import { z } from 'zod';
import { IncidentTypeSchema, SeveritySchema } from './enums';

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
