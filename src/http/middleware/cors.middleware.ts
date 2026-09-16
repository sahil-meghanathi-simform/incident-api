import cors from 'cors';
import { env } from '../../config/env';

// credentials:true + an explicit origin (never '*') is required both for the httpOnly
// refresh cookie (Q8) and because If-Match is not a CORS-safelisted header — without
// this exact allowlist every mutating request fails at preflight while Supertest (which
// never goes through a browser's CORS layer) stays green (build-plan.md finding B7).
export const corsMiddleware = cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'X-Contract-Version'],
});
