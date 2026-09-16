import pino from 'pino';
import { env } from '../config/env';

export const rootLogger = pino({
  level: env.LOG_LEVEL,
  // Pretty printing is a dev-time convenience only; production stays structured JSON.
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  base: { service: 'incident-api' },
});

export function childLogger(bindings: Record<string, unknown>) {
  return rootLogger.child(bindings);
}

export type Logger = typeof rootLogger;
