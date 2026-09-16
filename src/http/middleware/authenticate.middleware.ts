import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma';
import { verifyAccessToken } from '../../modules/auth/token.service';
import { TokenExpiredError, UnauthenticatedError } from '../../core/errors/http-errors';

/**
 * Verifies the access JWT, then re-reads role + clearanceLevel from the database on
 * EVERY request (not from the token). This single primary-key lookup is the entire
 * mechanism behind Q8b and Q10: a clearance or role change is effective on the target
 * user's very next request, with no session invalidation needed. It is a PK lookup on
 * an indexed column; its cost is documented in docs/query-plans.md.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthenticatedError());
    return;
  }
  const token = header.slice('Bearer '.length);

  let payload: { sub: string; sid: string };
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new TokenExpiredError());
      return;
    }
    next(new UnauthenticatedError('Access token is invalid.'));
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, clearanceLevel: true, isActive: true },
  });

  if (!user || !user.isActive) {
    next(new UnauthenticatedError());
    return;
  }

  req.actor = {
    id: user.id,
    role: user.role,
    clearanceLevel: user.clearanceLevel,
    sessionId: payload.sid,
  };
  next();
}
