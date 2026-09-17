import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { MyInvestigationsQuerySchema } from '../../contracts/investigation.contract';
import { myInvestigationsHandler } from './investigation.controller';

/**
 * Mounted at `/investigations` — distinct from `/incidents`, matching §10.1's own path
 * (`GET /api/v1/investigations/mine`). The two per-incident note routes live on
 * incidentRouter instead (`/incidents/:id/notes`), which already owns the S7
 * literal-route-ordering discipline for that resource.
 */
export const investigationRouter = Router();

investigationRouter.get(
  '/mine',
  authenticate,
  authorizeRole('INVESTIGATOR', 'ADMIN'),
  validate({ query: MyInvestigationsQuerySchema }),
  asyncHandler(myInvestigationsHandler),
);
