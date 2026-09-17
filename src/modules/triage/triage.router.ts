import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { TriageQueueQuerySchema } from '../../contracts/triage.contract';
import { triageQueueHandler } from './triage.controller';

/**
 * Mounted at `/triage` — distinct from `/incidents`, matching §9.1's own path
 * (`GET /api/v1/triage/queue`). The five per-incident actions live on incidentRouter
 * instead (`/incidents/:id/...`), which already owns the S7 literal-route-ordering
 * discipline for this resource.
 */
export const triageRouter = Router();

triageRouter.get(
  '/queue',
  authenticate,
  authorizeRole('TRIAGE_MANAGER', 'ADMIN'),
  validate({ query: TriageQueueQuerySchema }),
  asyncHandler(triageQueueHandler),
);
