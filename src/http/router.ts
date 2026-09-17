import { Router } from 'express';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../core/asyncHandler';
import { authRouter } from '../modules/auth/auth.router';
import { usersRouter } from '../modules/users/users.router';
import { incidentRouter } from '../modules/incidents/incident.router';
import { triageRouter } from '../modules/triage/triage.router';
import { investigationRouter } from '../modules/investigation/investigation.router';
import { closureRouter } from '../modules/closure/closure.router';

const CONTRACT_VERSION = '0.1.0';

export const apiRouter = Router();

/**
 * Mounted publicly, BEFORE authenticate is applied anywhere — the compose healthcheck
 * and the `api` service's `depends_on: migrate-seed` chain both hit this without a
 * token (build-plan.md finding B6: mounting /health after a global authenticate would
 * break both).
 */
apiRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'ok',
      dbLatencyMs: Date.now() - start,
      contractVersion: CONTRACT_VERSION,
    });
  }),
);

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/incidents', incidentRouter);
apiRouter.use('/triage', triageRouter);
apiRouter.use('/investigations', investigationRouter);
apiRouter.use('/closures', closureRouter);

// Further module routers are mounted here as each module is built. Each module's
// router.ts applies authenticate/authorizeRole/validate itself, per the layering rule
// in §2.2 — nothing in this file makes an authorization decision.

export { CONTRACT_VERSION };
