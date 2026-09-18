import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import {
  AdminJobRunsQuerySchema,
  AdminUserIdParamsSchema,
  AdminUsersQuerySchema,
  ChangeClearanceRequestSchema,
  ChangeRoleRequestSchema,
  ChangeStatusRequestSchema,
  ClearanceImpactQuerySchema,
  TierSetRequestSchema,
} from '../../contracts/admin.contract';
import {
  changeClearanceHandler,
  changeRoleHandler,
  changeStatusHandler,
  clearanceImpactHandler,
  getTiersHandler,
  listJobRunsHandler,
  listUsersHandler,
  putTiersHandler,
} from './admin.controller';

/**
 * Mounted at `/admin`, ADMIN-only for the WHOLE module via `router.use` — build-plan.md
 * §15.1: "mounted behind authorizeRole('ADMIN') at the router level, not per handler."
 * `/audit` (Module 8) and `POST /jobs/escalation/run` (Module 7, S7: registered once)
 * are the other two Admin screens, mounted separately by http/router.ts — the manual
 * job trigger is deliberately shared rather than duplicated here.
 */
export const adminRouter = Router();

adminRouter.use(authenticate, authorizeRole('ADMIN'));

adminRouter.get('/users', validate({ query: AdminUsersQuerySchema }), asyncHandler(listUsersHandler));

adminRouter.get(
  '/users/:id/clearance-impact',
  validate({ params: AdminUserIdParamsSchema, query: ClearanceImpactQuerySchema }),
  asyncHandler(clearanceImpactHandler),
);

adminRouter.patch(
  '/users/:id/role',
  validate({ params: AdminUserIdParamsSchema, body: ChangeRoleRequestSchema }),
  asyncHandler(changeRoleHandler),
);

adminRouter.patch(
  '/users/:id/clearance',
  validate({ params: AdminUserIdParamsSchema, body: ChangeClearanceRequestSchema }),
  asyncHandler(changeClearanceHandler),
);

adminRouter.patch(
  '/users/:id/status',
  validate({ params: AdminUserIdParamsSchema, body: ChangeStatusRequestSchema }),
  asyncHandler(changeStatusHandler),
);

adminRouter.get('/escalation-tiers', asyncHandler(getTiersHandler));

adminRouter.put('/escalation-tiers', validate({ body: TierSetRequestSchema }), asyncHandler(putTiersHandler));

adminRouter.get('/jobs/escalation/runs', validate({ query: AdminJobRunsQuerySchema }), asyncHandler(listJobRunsHandler));
