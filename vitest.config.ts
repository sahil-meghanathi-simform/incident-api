import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The advisory lock and the JobLease row are database-wide (build-plan.md B3):
    // running integration/scenario test FILES in parallel against the same
    // Testcontainers database would let them steal each other's lock and see spurious
    // SKIPPED_LOCKED outcomes. Pure unit tests have no shared state and are unaffected
    // by this, but a single global container is simplest for the whole POC suite.
    fileParallelism: false,
    globalSetup: ['./tests/setup/globalSetup.ts'],
  },
});
