import { expect, test } from '@playwright/test';

// The sign-in smoke test needs the Firebase Auth emulator with a seeded administrator (#61, not
// available yet) and the web build started with VITE_USE_AUTH_EMULATOR=true. Opt in with
// E2E_AUTH_EMULATOR=true plus E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (emulator-only test values).
const emulator = process.env['E2E_AUTH_EMULATOR'] === 'true';
const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? '';
const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';

test('login form validates input and offers no registration', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Daxil ol' })).toBeVisible();
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await expect(page.getByText('E-poçt ünvanını daxil edin')).toBeVisible();
  await expect(page.getByLabel(/^E-poçt/)).toBeFocused();
  await expect(page.getByRole('link', { name: /qeydiyyat|register|sign up/i })).toHaveCount(0);
});

test('forgot-password page is reachable from the login page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Parolu unutmusunuz?' }).click();
  await expect(page).toHaveURL(/\/login\/forgot-password$/);
  await expect(page.getByRole('heading', { name: 'Parolun sıfırlanması' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test.describe('with the Auth emulator and a seeded administrator', () => {
  test.skip(
    !emulator || !adminEmail || !adminPassword,
    'needs the Auth emulator, the seeded admin (#61) and VITE_USE_AUTH_EMULATOR=true; see web/README.md (Testing)',
  );

  test('administrator signs in and reaches the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/^E-poçt/).fill(adminEmail);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('a wrong password shows the generic message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/^E-poçt/).fill(adminEmail);
    await page.locator('input[autocomplete="current-password"]').fill(`${adminPassword}-wrong`);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await expect(page.getByRole('alert')).toHaveText('E-poçt və ya parol yanlışdır');
  });
});
