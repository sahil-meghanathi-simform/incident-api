import type { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    req.log.info(
      { method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start },
      'request completed',
    );
  });
  next();
}
