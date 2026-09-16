import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { childLogger } from '../../core/logger';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  req.log = childLogger({ requestId: req.requestId });
  next();
}
