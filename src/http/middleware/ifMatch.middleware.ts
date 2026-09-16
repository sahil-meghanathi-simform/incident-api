import type { NextFunction, Request, Response } from 'express';
import { ValidationFailedError } from '../../core/errors/http-errors';

/**
 * Extracts the optimistic-lock version from the If-Match header (§2.8). Runs after
 * validate(), before the controller. The service layer is what actually enforces it
 * (updateMany({ where: { id, version } })) — this middleware only parses the header
 * into req.ifMatchVersion so controllers don't each re-implement header parsing.
 */
export function ifMatch(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('if-match');
  if (header === undefined) {
    next(
      new ValidationFailedError([
        { path: 'If-Match', code: 'required', message: 'An If-Match header with the current version is required.' },
      ]),
    );
    return;
  }
  const version = Number(header.replace(/"/g, '').trim());
  if (!Number.isInteger(version) || version < 0) {
    next(
      new ValidationFailedError([
        { path: 'If-Match', code: 'invalid', message: 'If-Match must be a non-negative integer version.' },
      ]),
    );
    return;
  }
  req.ifMatchVersion = version;
  next();
}
