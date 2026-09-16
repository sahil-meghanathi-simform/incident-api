import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { childLogger } from '../core/logger';

const log = childLogger({ module: 'db' });

// Singleton client, as required for both Prisma's connection pooling and for the
// incident-repository layering rule (§2.2, scripts/check-layers.sh) to be checkable
// by a single grep across the codebase.
export const prisma = new PrismaClient({
  log:
    env.NODE_ENV === 'development'
      ? [{ level: 'query', emit: 'event' }, { level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }]
      : [{ level: 'error', emit: 'stdout' }],
});

if (env.NODE_ENV === 'development') {
  // Query-duration logging, as called for in §4.1's db/ responsibility description.
  prisma.$on('query' as never, (e: { query: string; duration: number }) => {
    if (e.duration > 50) {
      log.debug({ durationMs: e.duration, query: e.query }, 'slow query');
    }
  });
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
