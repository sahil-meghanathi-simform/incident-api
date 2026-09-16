import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../contracts/enums';
import { InsufficientRoleError, UnauthenticatedError } from '../../core/errors/http-errors';

/** Coarse action gate. Mounted at the router level for whole modules (e.g. all of /admin). */
export function authorizeRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) {
      next(new UnauthenticatedError());
      return;
    }
    if (!roles.includes(req.actor.role)) {
      next(new InsufficientRoleError(roles));
      return;
    }
    next();
  };
}
