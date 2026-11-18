import { defineConfig, devices } from '@playwright/test';

// Smoke suite against the running on-prem compose stack (docker-compose.onprem.yml), reached through
// nginx with its self-signed certificate. No dev servers are started: `.github/workflows/onprem.yml`
// brings the stack up first. Besides the sign-in free smoke specs, `onprem-oidc.spec.ts` signs in through Keycloak.
export default defineConfig({
  testDir: 'e2e',
  testMatch: ['smoke.spec.ts', 'onprem-oidc.spec.ts'],
  grep: /unknown route|language can be switched|through Keycloak/,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['ONPREM_URL'] ?? 'https://localhost:8443',
    ignoreHTTPSErrors: true,
    locale: 'az-AZ',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'az-AZ' } }],
});
