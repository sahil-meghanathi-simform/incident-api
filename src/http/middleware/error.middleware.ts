import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../../core/errors/AppError';
import { ValidationFailedError } from '../../core/errors/http-errors';
import { InternalError } from '../../core/errors/http-errors';
import { StaleVersionError } from '../../core/errors/domain-errors';
import { env } from '../../config/env';

/**
 * The single place a Prisma/Zod/AppError becomes the §2.7 envelope. MUST be registered
 * after notFound and MUST declare all four parameters — Express only treats a handler
 * as error-handling middleware when it has arity 4; a (req,res,next) handler here would
 * silently never fire and every error would fall through to Express's default HTML
 * error page (build-plan.md finding B6).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? 'unknown';

  if (err instanceof AppError) {
    if (err.status >= 500) {
      req.log?.error({ err, code: err.code }, 'internal error');
    } else {
      req.log?.warn({ code: err.code, status: err.status }, 'request rejected');
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details ? { details: err.details } : {}),
        ...(err.meta ? { meta: err.meta } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const mapped = new ValidationFailedError(
      err.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
    );
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message, requestId, details: mapped.details },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025: record not found for an update/delete predicate that included `version` —
    // this is how a stale If-Match surfaces from updateMany({ where: { id, version } }).
    if (err.code === 'P2025') {
      const mapped = new StaleVersionError(-1);
      res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message, requestId } });
      return;
    }
    // 23514 = Postgres check_violation, surfaced by Prisma as P2010/unknown depending on
    // path. Logged loudly with the constraint name so a violation is obvious rather than
    // a mystery 500 — every write path that could hit one is covered by
    // triage.service.ts::applySeverityChange and closure.service.ts, so this should
    // never fire in practice.
    req.log?.error({ err, prismaCode: err.code }, 'unmapped Prisma error');
  } else {
    req.log?.error({ err }, 'unhandled error');
  }

  const fallback = new InternalError();
  res.status(fallback.status).json({
    error: {
      code: fallback.code,
      message: fallback.message,
      requestId,
      ...(env.NODE_ENV !== 'production' && err instanceof Error ? { meta: { debug: err.message } } : {}),
    },
  });
}
