import { z } from 'zod';

// This file has no imports outside zod — it is exported verbatim to incident-web via
// `npm run contracts:export`.

export const AssignableInvestigatorQuerySchema = z
  .object({
    minClearance: z.coerce.number().int().min(1).max(4).optional(),
  })
  .strict();
export type AssignableInvestigatorQuery = z.infer<typeof AssignableInvestigatorQuerySchema>;

export const AssignableInvestigatorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  clearanceLevel: z.number().int().min(1).max(4),
});
export type AssignableInvestigator = z.infer<typeof AssignableInvestigatorSchema>;
