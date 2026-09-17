import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authorizeRole } from '../../http/middleware/authorizeRole.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { EscalationEventsParamsSchema, EscalationFeedQuerySchema } from '../../contracts/escalation.contract';
import { feedHandler, incidentEventsHandler, runJobHandler, tiersHandler } from './escalation.controller';

/**
 * Mounted at `/escalations`. `/tiers` is a literal route registered before the
 * `:incidentId` segment (S7 discipline) even though the two can never actually
 * collide here (different segment counts) — kept consistent with every other
 * resource in this codebase rather than relying on that fact.
 *
 * Role gating: the feed itself (GET /) is open to any authenticated actor, scoped
 * purely by clearance (visibilityScope) — SideNav links it for every role, matching
 * how /incidents itself works. `/tiers` is deliberately open too (build-plan.md's
 * smaller-items list: any role needs the thresholds for tooltips/help text). Only
 * `/:incidentId/events` is role-gated to TRIAGE_MANAGER/ADMIN, mirroring the same
 * `escalation` field's own gate on the incident detail response (§8.1).
 */
export const escalationRouter = Router();

escalationRouter.get('/', authenticate, validate({ query: EscalationFeedQuerySchema }), asyncHandler(feedHandler));

escalationRouter.get('/tiers', authenticate, asyncHandler(tiersHandler));

escalationRouter.get(
  '/:incidentId/events',
  authenticate,
  authorizeRole('TRIAGE_MANAGER', 'ADMIN'),
  validate({ params: EscalationEventsParamsSchema }),
  asyncHandler(incidentEventsHandler),
);

/**
 * `POST /jobs/escalation/run` — mounted separately, at `/jobs`, by http/router.ts.
 * Kept in this module (not a standalone jobs module) per build-plan.md's S7 finding:
 * the reference plan registered this route twice, in two different places, with two
 * different middleware chains; the fix is registering it exactly once.
 */
export const jobsRouter = Router();

jobsRouter.post('/escalation/run', authenticate, authorizeRole('ADMIN'), asyncHandler(runJobHandler));
