import type { NextFunction, Request, Response } from 'express';
import { RateLimitedError } from '../../core/errors/http-errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory token bucket, scoped to auth routes only (register/login), per §4's
 * middleware list. A single-process POC has no need for a shared store; documented as
 * a known limitation if the API ever runs multi-instance without a shared cache.
 */
export function rateLimit(opts: { windowMs: number; max: number; keyFn?: (req: Request) => string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = opts.keyFn ? opts.keyFn(req) : req.ip ?? 'unknown';
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    if (existing.count >= opts.max) {
      next(new RateLimitedError(Math.ceil((existing.resetAt - now) / 1000)));
      return;
    }

    existing.count += 1;
    next();
  };
}

export function authRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyFn: (req) => `${req.ip ?? 'unknown'}:${String((req.body as { email?: string })?.email ?? '')}`,
  });
}
