import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://127.0.0.1:5173';

// Smoke suite against the Vite dev server and the API with in-process (memory) adapters. It runs
// in CI on merges to `dev` and nightly, not on every PR (see .github/workflows/e2e.yml).
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
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
        EMAIL_PROVIDER: 'gmail',
        EMAIL_FROM_ADDRESS: 'certificates@example.com',
        EMAIL_FROM_NAME: 'Certificate Manager',
        DB_ADAPTER: 'memory',
        STORAGE_ADAPTER: 'memory',
        QUEUE_ADAPTER: 'in-process',
        AUTH_PROVIDER: 'firebase',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1',
      url: WEB_URL,
      reuseExistingServer: !process.env['CI'],
    },
  ],
});
