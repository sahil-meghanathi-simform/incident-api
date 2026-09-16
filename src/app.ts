import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { requestId } from './http/middleware/requestId.middleware';
import { requestLogger } from './http/middleware/requestLogger.middleware';
import { corsMiddleware } from './http/middleware/cors.middleware';
import { securityHeaders } from './http/middleware/securityHeaders.middleware';
import { notFound } from './http/middleware/notFound.middleware';
import { errorMiddleware } from './http/middleware/error.middleware';
import { apiRouter } from './http/router';
import { CONTRACT_VERSION } from './http/router';

/**
 * Express app factory, exported (not started) so tests/setup can create a fresh app
 * per Testcontainers-backed test run via Supertest, per §4's reference to app.ts.
 *
 * Middleware order matters and follows §2.5, corrected per build-plan.md finding B6:
 *   requestId → requestLogger → cors → securityHeaders → json body limit → cookieParser
 *   → apiRouter (each module applies authenticate/validate/ifMatch itself)
 *   → notFound (app.use, not '*') → errorMiddleware (4-arg, registered last)
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(requestLogger);
  app.use(corsMiddleware);
  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.use((_, res, next) => {
    res.setHeader('X-Contract-Version', CONTRACT_VERSION);
    next();
  });

  app.use('/api/v1', apiRouter);

  app.use(notFound);
  app.use(errorMiddleware);

  return app;
}
