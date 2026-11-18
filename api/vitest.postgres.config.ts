import { defineConfig } from 'vitest/config';

// PostgreSQL adapter tests against a real server: `POSTGRES_TEST_URL=postgres://... npm run
// test:postgres -w @certificate-manager/api`. Without the variable the suites are skipped.
export default defineConfig({
  test: {
    include: ['test/postgres/**/*.postgres.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
