import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { childLogger } from '../core/logger';

const log = childLogger({ module: 'db' });

// Singleton client, as required for both Prisma's connection pooling and for the
// incident-repository layering rule (§2.2, scripts/check-layers.sh) to be checkable
// by a single grep across the codebase.
// 'test' gets the same event emission as 'development' (not just 'error' logging) so
// tests/integration/analytics.spec.ts's query-count assertion (build-plan.md Module 9's
// "guards a future N+1") can listen on real 'query' events rather than mocking Prisma's
// internals — this codebase's whole testing philosophy is proving things against real
// Postgres, never a mock (see tests/setup/globalSetup.ts's Testcontainers setup).
export const prisma = new PrismaClient({
  log:
    env.NODE_ENV !== 'production'
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
