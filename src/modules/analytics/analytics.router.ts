import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import {
  AnalyticsEscalationPerformanceQuerySchema,
  AnalyticsExportQuerySchema,
  AnalyticsMatrixQuerySchema,
  AnalyticsOverviewQuerySchema,
  AnalyticsTrendQuerySchema,
} from '../../contracts/analytics.contract';
import {
  escalationPerformanceHandler,
  exportCsvHandler,
  matrixHandler,
  overviewHandler,
  trendHandler,
} from './analytics.controller';

/**
 * Mounted at `/analytics`. `overview`/`by-type-severity`/`trend`/`export.csv` are open
 * to any authenticated actor, scoped purely by clearance (`visibleSeverities`) — same
 * "auth, not role" pattern as the escalation feed (escalation.router.ts), since two
 * users legitimately seeing different totals for the same period is the point (§1.8),
 * not something to also gate by role. `escalation-performance` keeps the reference
 * plan's TRIAGE_MANAGER/ADMIN role gate (never flagged as wrong — only its MISSING
 * clearance scope was, build-plan.md S2, fixed in analytics.repository.ts).
 */
export const analyticsRouter = Router();

analyticsRouter.get('/overview', authenticate, validate({ query: AnalyticsOverviewQuerySchema }), asyncHandler(overviewHandler));

analyticsRouter.get(
  '/by-type-severity',
  authenticate,
  validate({ query: AnalyticsMatrixQuerySchema }),
  asyncHandler(matrixHandler),
);

analyticsRouter.get('/trend', authenticate, validate({ query: AnalyticsTrendQuerySchema }), asyncHandler(trendHandler));

analyticsRouter.get(
  '/escalation-performance',
  authenticate,
  authorizeRole('TRIAGE_MANAGER', 'ADMIN'),
  validate({ query: AnalyticsEscalationPerformanceQuerySchema }),
  asyncHandler(escalationPerformanceHandler),
);

analyticsRouter.get(
  '/export.csv',
  authenticate,
  validate({ query: AnalyticsExportQuerySchema }),
  asyncHandler(exportCsvHandler),
);
