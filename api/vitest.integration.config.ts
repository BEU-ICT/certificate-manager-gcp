import { defineConfig } from 'vitest/config';

// Integration tests: files named `*.integration.test.ts` under test/integration/. Run only through
// `npm run test:integration`, which starts the Firebase emulators once and exports their hosts
// (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, GCLOUD_PROJECT) to this process.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    // All files share one emulator instance. Running them one after another keeps resetFirestore()
    // in one file from wiping the data of another.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
