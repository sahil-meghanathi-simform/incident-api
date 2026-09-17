import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { NotificationIdParamsSchema, NotificationsQuerySchema } from '../../contracts/escalation.contract';
import { listNotificationsHandler, markNotificationReadHandler } from './notification.controller';

/**
 * Mounted at `/notifications`. No role gate — recipientsFor (escalation.job.ts) only
 * ever creates NotificationLog rows for TRIAGE_MANAGER/ADMIN, so a REPORTER's list is
 * always empty by construction; scoping by role here would be redundant, not safer.
 */
export const notificationsRouter = Router();

notificationsRouter.get('/', authenticate, validate({ query: NotificationsQuerySchema }), asyncHandler(listNotificationsHandler));

notificationsRouter.post(
  '/:id/read',
  authenticate,
  validate({ params: NotificationIdParamsSchema }),
  asyncHandler(markNotificationReadHandler),
);
