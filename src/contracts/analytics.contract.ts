import { z } from 'zod';
import { IncidentTypeSchema, SeveritySchema, StageSchema } from './enums';
import { csvArrayQueryParam } from './pagination.contract';

// This file has no imports outside zod/sibling contracts — it is exported verbatim to
// incident-web via `npm run contracts:export` (see scripts/contracts-export.ts).

// Duplicated here (not imported from src/config/constants.ts, which instead re-exports
// THIS value) precisely so the frontend gets the same number and can clamp a
// hand-edited URL client-side before firing a request that would 422 (build-plan.md
// Module 9's "Done when": missing `from`/`to`-too-wide both 422, and the SPA never
// needs to discover the cap by trial and error).
export const ANALYTICS_MAX_RANGE_DAYS = 366;

const IsoDateStringSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'must be a valid date');

/**
 * Half-open `[from, to)` everywhere (build-plan.md S4: the reference plan's Prisma path
 * used `lte: to` while its trend raw SQL used `< to`, so the matrix and the chart
 * disagreed on an incident created exactly at `to`). This refinement only guards the
 * upfront shape (missing/reversed/too-wide → 422 before any query runs); the actual
 * half-open bound is computed once in analytics.service.ts via core/time.ts's
 * `exclusiveEndOfDay`, and every repository function receives that same computed value
 * — never `to` re-parsed independently — so the two paths cannot drift.
 */
function periodRefinement(val: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const fromMs = Date.parse(val.from);
  const toMs = Date.parse(val.to);
  if (toMs < fromMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: '"to" must not be before "from".' });
    return;
  }
  const days = (toMs - fromMs) / 86_400_000;
  if (days > ANALYTICS_MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: `The period cannot span more than ${ANALYTICS_MAX_RANGE_DAYS} days.`,
    });
  }
}

const AnalyticsPeriodFieldsSchema = z.object({
  from: IsoDateStringSchema,
  to: IsoDateStringSchema,
  type: csvArrayQueryParam(IncidentTypeSchema),
  stage: csvArrayQueryParam(StageSchema),
});

export const AnalyticsOverviewQuerySchema = AnalyticsPeriodFieldsSchema.strict().superRefine(periodRefinement);
export type AnalyticsOverviewQuery = z.infer<typeof AnalyticsOverviewQuerySchema>;

export const AnalyticsMatrixQuerySchema = AnalyticsPeriodFieldsSchema.strict().superRefine(periodRefinement);
export type AnalyticsMatrixQuery = z.infer<typeof AnalyticsMatrixQuerySchema>;

export const BucketSchema = z.enum(['day', 'week', 'month']);
export type Bucket = z.infer<typeof BucketSchema>;

export const AnalyticsTrendQuerySchema = AnalyticsPeriodFieldsSchema.extend({ bucket: BucketSchema.default('day') })
  .strict()
  .superRefine(periodRefinement);
export type AnalyticsTrendQuery = z.infer<typeof AnalyticsTrendQuerySchema>;

export const AnalyticsEscalationPerformanceQuerySchema = AnalyticsPeriodFieldsSchema.strict().superRefine(periodRefinement);
export type AnalyticsEscalationPerformanceQuery = z.infer<typeof AnalyticsEscalationPerformanceQuerySchema>;

export const AnalyticsExportQuerySchema = AnalyticsPeriodFieldsSchema.strict().superRefine(periodRefinement);
export type AnalyticsExportQuery = z.infer<typeof AnalyticsExportQuerySchema>;

export const AnalyticsPeriodSchema = z.object({ from: z.string(), to: z.string() });
export type AnalyticsPeriod = z.infer<typeof AnalyticsPeriodSchema>;

export const AnalyticsOverviewResponseSchema = z.object({
  period: AnalyticsPeriodSchema,
  totalIncidents: z.number().int(),
  openIncidents: z.number().int(),
  escalatedIncidents: z.number().int(),
  medianAckSeconds: z.number().nullable(),
});
export type AnalyticsOverviewResponse = z.infer<typeof AnalyticsOverviewResponseSchema>;

export const TypeSeverityCellSchema = z.object({
  type: IncidentTypeSchema,
  severity: SeveritySchema,
  count: z.number().int(),
});
export type TypeSeverityCell = z.infer<typeof TypeSeverityCellSchema>;

const TypeTotalSchema = z.object({ type: IncidentTypeSchema, count: z.number().int() });
const SeverityTotalSchema = z.object({ severity: SeveritySchema, count: z.number().int() });

/**
 * `severities` echoes exactly the columns this actor's cells were zero-filled over —
 * `visibleSeverities(actor.clearanceLevel)`, never all four unconditionally. A
 * clearance-2 actor structurally cannot have any HIGH/CRITICAL row (visibilityScope
 * already excludes them from the underlying query), so rendering those columns as a
 * confident "0" would misstate reality — there may be plenty, just not to this viewer.
 * The frontend renders exactly these columns and lets `ClearanceScopeNotice` explain
 * the rest, rather than a fabricated all-zero column.
 */
export const TypeSeverityMatrixResponseSchema = z.object({
  period: AnalyticsPeriodSchema,
  severities: z.array(SeveritySchema),
  cells: z.array(TypeSeverityCellSchema),
  rowTotals: z.array(TypeTotalSchema),
  columnTotals: z.array(SeverityTotalSchema),
  grandTotal: z.number().int(),
});
export type TypeSeverityMatrixResponse = z.infer<typeof TypeSeverityMatrixResponseSchema>;

export const TrendPointSchema = z.object({
  bucketStart: z.string(),
  severity: SeveritySchema,
  count: z.number().int(),
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const TrendResponseSchema = z.object({
  period: AnalyticsPeriodSchema,
  bucket: BucketSchema,
  severities: z.array(SeveritySchema),
  points: z.array(TrendPointSchema),
});
export type TrendResponse = z.infer<typeof TrendResponseSchema>;

export const EscalationPerformanceRowSchema = z.object({
  severity: SeveritySchema,
  escalatedCount: z.number().int(),
  acknowledgedCount: z.number().int(),
  medianAckSeconds: z.number().nullable(),
  p90AckSeconds: z.number().nullable(),
});
export type EscalationPerformanceRow = z.infer<typeof EscalationPerformanceRowSchema>;

export const EscalationPerformanceResponseSchema = z.object({
  period: AnalyticsPeriodSchema,
  bySeverity: z.array(EscalationPerformanceRowSchema),
});
export type EscalationPerformanceResponse = z.infer<typeof EscalationPerformanceResponseSchema>;
