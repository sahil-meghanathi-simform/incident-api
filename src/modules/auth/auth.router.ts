import { Router } from 'express';
import { asyncHandler } from '../../core/asyncHandler';
import { authenticate } from '../../http/middleware/authenticate.middleware';
import { authRateLimit } from '../../http/middleware/rateLimit.middleware';
import { validate } from '../../http/middleware/validate.middleware';
import { LoginRequestSchema, RegisterRequestSchema } from '../../contracts/auth.contract';
import { loginHandler, logoutHandler, meHandler, refreshHandler, registerHandler } from './auth.controller';

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimit(),
  validate({ body: RegisterRequestSchema }),
  asyncHandler(registerHandler),
);

authRouter.post('/login', authRateLimit(), validate({ body: LoginRequestSchema }), asyncHandler(loginHandler));

// Public: authenticated only by the httpOnly refresh cookie, never a Bearer token —
// this is the one endpoint a client calls precisely because its access token is gone.
authRouter.post('/refresh', asyncHandler(refreshHandler));

authRouter.post('/logout', authenticate, asyncHandler(logoutHandler));

authRouter.get('/me', authenticate, asyncHandler(meHandler));
