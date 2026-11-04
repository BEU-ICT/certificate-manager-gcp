import { defineConfig } from 'vitest/config';

// Unit, contract and architecture tests. Integration tests need the Firebase emulators and run
// through `npm run test:integration` (vitest.integration.config.ts) instead.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'test/integration/**'],
    environment: 'node',
  },
});
