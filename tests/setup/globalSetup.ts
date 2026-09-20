import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';

/**
 * Vitest `globalSetup` (NOT `setupFiles`): this runs once, in the main process, BEFORE
 * Vitest spawns any worker for any test file. That ordering is load-bearing — every
 * application module (starting with src/config/env.ts, which fails fast if
 * DATABASE_URL/JWT secrets are missing) reads process.env at IMPORT time, and Node
 * caches modules, so DATABASE_URL must be set before the first import of anything
 * under src/, not merely before the first test runs. Workers inherit process.env as it
 * stands at spawn time, which is after this function returns (Q30 decision: real
 * Postgres via Testcontainers, not a mock).
 */
export default async function setup() {
  // Fail-fast secrets env.ts requires but that a pure test run has no reason to supply
  // via .env — only set if not already provided by the environment.
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters-long';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters-long';
  process.env.LOG_LEVEL ??= 'silent';
  // No test exercises a real Supabase upload (network-dependent, not Testcontainers-
  // controlled) — a placeholder satisfies env.ts's fail-fast check without either
  // vendoring real credentials into the suite or making a live network call.
  process.env.SUPABASE_URL ??= 'https://placeholder.supabase.co';
  process.env.SUPABASE_SECRET_KEY ??= 'test-placeholder-secret-key';

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16')
    .withDatabase('incident_test')
    .withUsername('incident')
    .withPassword('incident')
    .start();

  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  return async () => {
    await container.stop();
  };
}
