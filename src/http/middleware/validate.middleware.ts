import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ValidationFailedError } from '../../core/errors/http-errors';
import type { ErrorDetail } from '../../core/errors/AppError';

export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function zodIssuesToDetails(err: ZodError): ErrorDetail[] {
  return err.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
    received: 'received' in issue ? (issue as { received?: unknown }).received : undefined,
  }));
}

/**
 * Writes parsed values to req.validated — never back to req.query/req.body/req.params.
 * Express 5 defines req.query as a getter-only property; assigning to it throws under
 * strict ESM and no-ops silently under sloppy CJS, either of which would defeat the
 * "rejected before business logic" guarantee (build-plan.md finding B6). This runs
 * BEFORE the controller, which is the actual mechanism behind that guarantee.
 */
export function validate(schemas: ValidateSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.validated = {
        body: schemas.body ? schemas.body.parse(req.body) : undefined,
        query: schemas.query ? schemas.query.parse(req.query) : undefined,
        params: schemas.params ? schemas.params.parse(req.params) : undefined,
      };
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(new ValidationFailedError(zodIssuesToDetails(err)));
        return;
      }
      next(err);
    }
  };
}
