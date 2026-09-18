import { z } from 'zod';
import { RoleSchema, SeveritySchema } from './enums';
import { booleanQueryParam, csvArrayQueryParam, offsetEnvelopeSchema, offsetQuerySchema } from './pagination.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

// Same discipline as IncidentIdParamsSchema (build-plan.md S7): reject a malformed id
// with 422 at the validation layer rather than falling through to a confusing 404.
export const AdminUserIdParamsSchema = z
  .object({ id: z.string().regex(/^[a-z0-9]{20,32}$/i, 'must be a valid user id') })
  .strict();
export type AdminUserIdParams = z.infer<typeof AdminUserIdParamsSchema>;

// ---------------------------------------------------------------------------
// GET /admin/users
// ---------------------------------------------------------------------------

export const AdminUsersQuerySchema = offsetQuerySchema
  .extend({
    role: csvArrayQueryParam(RoleSchema),
    isActive: booleanQueryParam(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>;

export const AdminUserRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  clearanceLevel: z.number().int().min(1).max(4),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminUsersResponseSchema = offsetEnvelopeSchema(AdminUserRowSchema);
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/{role,clearance,status}
// ---------------------------------------------------------------------------

export const ChangeRoleRequestSchema = z.object({ role: RoleSchema }).strict();
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequestSchema>;

export const ChangeClearanceRequestSchema = z.object({ clearanceLevel: z.number().int().min(1).max(4) }).strict();
export type ChangeClearanceRequest = z.infer<typeof ChangeClearanceRequestSchema>;

export const ChangeStatusRequestSchema = z.object({ isActive: z.boolean() }).strict();
export type ChangeStatusRequest = z.infer<typeof ChangeStatusRequestSchema>;

// Single response shape for all three mutations so the frontend's three hooks can
// share one cache-update path. `affectedIncidentCount` is always 0 for role/status —
// only a clearance LOWERING can strand an assignment (Q17's mirror) — but it is never
// omitted, so the caller never has to special-case which endpoint it called.
export const AdminUserMutationResponseSchema = z.object({
  user: AdminUserRowSchema,
  affectedIncidentCount: z.number().int(),
});
export type AdminUserMutationResponse = z.infer<typeof AdminUserMutationResponseSchema>;

// ---------------------------------------------------------------------------
// GET /admin/users/:id/clearance-impact — the preview ClearanceImpactDialog calls
// BEFORE the drawer confirms a lowering PATCH, so the affected incidents can be listed
// by reference first (build-plan.md §15.2). Read-only: computes the exact same set the
// PATCH's own cascade would touch, without writing anything.
// ---------------------------------------------------------------------------

export const ClearanceImpactQuerySchema = z.object({ clearanceLevel: z.coerce.number().int().min(1).max(4) }).strict();
export type ClearanceImpactQuery = z.infer<typeof ClearanceImpactQuerySchema>;

export const ClearanceImpactIncidentSchema = z.object({
  id: z.string(),
  reference: z.string(),
  severity: SeveritySchema,
});
export type ClearanceImpactIncident = z.infer<typeof ClearanceImpactIncidentSchema>;

export const ClearanceImpactResponseSchema = z.object({
  affectedIncidents: z.array(ClearanceImpactIncidentSchema),
  count: z.number().int(),
});
export type ClearanceImpactResponse = z.infer<typeof ClearanceImpactResponseSchema>;

// ---------------------------------------------------------------------------
// GET/PUT /admin/escalation-tiers — the write side of GET /escalations/tiers (Module
// 7, auth-open, read-only). Validated as a SET, not row-by-row (build-plan.md §15.1
// rule 4): levels contiguous from 1 within each severity, thresholds strictly
// increasing within each severity. Enforced here, in the Zod schema, so an invalid
// payload is a 422 VALIDATION_FAILED from the ordinary validate() middleware —
// exactly like every other shape rule in this codebase — never a bespoke service-layer
// error class.
// ---------------------------------------------------------------------------

export const TierInputSchema = z.object({
  severity: SeveritySchema,
  level: z.number().int().min(1),
  thresholdMinutes: z.number().int().min(1),
});
export type TierInput = z.infer<typeof TierInputSchema>;

export const TierSetRequestSchema = z
  .object({ tiers: z.array(TierInputSchema).min(1) })
  .strict()
  .superRefine((val, ctx) => {
    const bySeverity = new Map<string, TierInput[]>();
    for (const tier of val.tiers) {
      const list = bySeverity.get(tier.severity) ?? [];
      list.push(tier);
      bySeverity.set(tier.severity, list);
    }

    const seenKeys = new Set<string>();
    for (const tier of val.tiers) {
      const key = `${tier.severity}:${tier.level}`;
      if (seenKeys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiers'],
          message: `duplicate tier for ${tier.severity} level ${tier.level}`,
        });
      }
      seenKeys.add(key);
    }

    for (const [severity, list] of bySeverity) {
      const levels = [...new Set(list.map((t) => t.level))].sort((a, b) => a - b);
      const isContiguous = levels.every((level, index) => level === index + 1);
      if (!isContiguous) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiers'],
          message: `${severity} tier levels must be contiguous starting at 1 (got ${levels.join(', ')})`,
        });
      }

      const byLevel = [...list].sort((a, b) => a.level - b.level);
      for (let i = 1; i < byLevel.length; i += 1) {
        const previous = byLevel[i - 1]!;
        const current = byLevel[i]!;
        if (current.thresholdMinutes <= previous.thresholdMinutes) {
          ctx.addIssue({
            code: 'custom',
            path: ['tiers'],
            message: `${severity} thresholds must strictly increase with level (level ${current.level} <= level ${previous.level})`,
          });
        }
      }
    }
  });
export type TierSetRequest = z.infer<typeof TierSetRequestSchema>;

// ---------------------------------------------------------------------------
// GET /admin/jobs/escalation/runs
// ---------------------------------------------------------------------------

export const AdminJobRunsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export type AdminJobRunsQuery = z.infer<typeof AdminJobRunsQuerySchema>;

export const AdminJobRunSchema = z.object({
  id: z.string(),
  jobName: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcome: z.enum(['COMPLETED', 'SKIPPED_LOCKED', 'FAILED']).nullable(),
  scanned: z.number().int(),
  escalated: z.number().int(),
  notified: z.number().int(),
  error: z.string().nullable(),
});
export type AdminJobRun = z.infer<typeof AdminJobRunSchema>;

export const AdminJobRunsResponseSchema = z.object({ runs: z.array(AdminJobRunSchema) });
export type AdminJobRunsResponse = z.infer<typeof AdminJobRunsResponseSchema>;
