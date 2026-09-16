import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../../core/errors/http-errors';

/**
 * Mounted with app.use(notFound) — NOT app.get('*', notFound). Express 5's router
 * (path-to-regexp 8) rejects a bare '*' at boot with a TypeError, so that form never
 * gets a chance to run (build-plan.md finding B6). app.use with no path matches
 * anything that fell through every real route.
 */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('Route', req.path));
}
