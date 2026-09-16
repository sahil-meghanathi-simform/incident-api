import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { AssignableInvestigatorQuerySchema } from '../../contracts/user.contract';
import { assignableInvestigatorsHandler } from './users.controller';

export const usersRouter = Router();

usersRouter.get(
  '/assignable-investigators',
  authenticate,
  authorizeRole('TRIAGE_MANAGER', 'ADMIN'),
  validate({ query: AssignableInvestigatorQuerySchema }),
  asyncHandler(assignableInvestigatorsHandler),
);
