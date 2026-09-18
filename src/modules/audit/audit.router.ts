import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { AuditSearchQuerySchema } from '../../contracts/audit.contract';
import { searchAuditHandler } from './audit.controller';

/**
 * Mounted at `/audit`. ADMIN-only — Module 10's global search screen — unlike
 * `/incidents/:id/timeline`, which is mounted in incident.router.ts and open to any
 * actor who can see that one incident (see timeline.service.ts).
 */
export const auditRouter = Router();

auditRouter.get(
  '/',
  authenticate,
  authorizeRole('ADMIN'),
  validate({ query: AuditSearchQuerySchema }),
  asyncHandler(searchAuditHandler),
);
