import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://127.0.0.1:5173';

// Full-stack mode (`npm run test:e2e:auth`): Firestore + Auth emulators, fs storage and the file
// e-mail sink, all in a throw-away directory. Worker processes inherit E2E_DATA_DIR from here.
const FULL_STACK = process.env['E2E_AUTH_EMULATOR'] === 'true';
process.env['E2E_DATA_DIR'] ??= mkdtempSync(join(tmpdir(), 'cm-e2e-'));
const DATA_DIR = process.env['E2E_DATA_DIR'];

// Smoke suite against the Vite dev server and the API with in-process (memory) adapters. It runs
// in CI on merges to `dev` and nightly, not on every PR (see .github/workflows/e2e.yml).
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // One worker in full-stack mode: all specs share one administrator, one Firestore and the API's rate limits.
  ...(FULL_STACK ? { workers: 1 } : {}),
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    locale: 'az-AZ',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'az-AZ' } }],
  webServer: [
    {
      command: 'npm run dev -w @certificate-manager/api',
      cwd: '..',
      url: 'http://127.0.0.1:8080/internal/healthz',
      reuseExistingServer: !process.env['CI'],
      env: {
        NODE_ENV: 'development',
        PORT: '8080',
        LOG_LEVEL: 'warn',
        GCP_PROJECT: 'demo-certificate-manager',
        SERVICE_URL: 'http://127.0.0.1:8080',
        PUBLIC_BASE_URL: WEB_URL,
        PDF_PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
        BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
        EMAIL_PROVIDER: FULL_STACK ? 'file' : 'gmail',
        ...(FULL_STACK ? { EMAIL_FILE_DIR: join(DATA_DIR, 'mail') } : {}),
        EMAIL_FROM_ADDRESS: 'certificates@example.com',
        EMAIL_FROM_NAME: 'Certificate Manager',
        DB_ADAPTER: FULL_STACK ? 'firestore' : 'memory',
        STORAGE_ADAPTER: FULL_STACK ? 'fs' : 'memory',
        ...(FULL_STACK ? { STORAGE_FS_ROOT: join(DATA_DIR, 'storage') } : {}),
        QUEUE_ADAPTER: 'in-process',
        AUTH_PROVIDER: 'firebase',
        // The full-stack suite makes far more requests per minute than a person would.
        ...(FULL_STACK
          ? { RATE_LIMIT_ADMIN_PER_MIN: '100', RATE_LIMIT_PUBLIC_PER_MIN: '1000' }
          : {}),
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: WEB_URL,
      reuseExistingServer: !process.env['CI'],
    },
  ],
});
