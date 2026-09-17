import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { ClosuresPendingQuerySchema } from '../../contracts/closure.contract';
import { closuresPendingHandler } from './closure.controller';

/**
 * Mounted at `/closures` — distinct from `/incidents`, matching the same pattern as
 * `/triage/queue` and `/investigations/mine`. The three per-incident closure actions
 * live on incidentRouter instead (`/incidents/:id/closure-*`), which already owns the
 * S7 literal-route-ordering discipline for this resource.
 */
export const closureRouter = Router();

closureRouter.get(
  '/pending',
  authenticate,
  authorizeRole('TRIAGE_MANAGER', 'ADMIN'),
  validate({ query: ClosuresPendingQuerySchema }),
  asyncHandler(closuresPendingHandler),
);
