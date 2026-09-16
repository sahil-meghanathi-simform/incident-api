import { Router } from 'express';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../core/asyncHandler';
import { authRouter } from '../modules/auth/auth.router';
import { usersRouter } from '../modules/users/users.router';

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

// Further module routers are mounted here as each module is built:
//   apiRouter.use('/incidents', incidentRouter);
//   ...
// Each module's router.ts applies authenticate/authorizeRole/validate itself, per the
// layering rule in §2.2 — nothing in this file makes an authorization decision.

export { CONTRACT_VERSION };
