import { expect, test } from '@playwright/test';

// Needs the Auth emulator and a seeded administrator (#61), like the sign-in tests in
// admin-login.spec.ts; see web/README.md (Testing). The locale is az-AZ (playwright.config.ts).
const emulator = process.env['E2E_AUTH_EMULATOR'] === 'true';
const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? '';
const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';

test.describe('organizations (signed in as administrator)', () => {
  test.skip(
    !emulator || !adminEmail || !adminPassword,
    'needs the Auth emulator, the seeded admin (#61) and VITE_USE_AUTH_EMULATOR=true; see web/README.md (Testing)',
  );

  test('creates an organization and lists it with the suggested slug', async ({ page }) => {
    await page.goto('/admin/organizations');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel(/^E-poçt/).fill(adminEmail);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await expect(page).toHaveURL(/\/admin\/organizations$/);
    await expect(page.getByRole('heading', { name: 'Təşkilatlar', level: 1 })).toBeVisible();

    const name = `Əhməd Təşkilat ${Date.now().toString(36)}`;
    await page.getByRole('button', { name: 'Yeni təşkilat' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Ad/).fill(name);
    await expect(dialog.getByLabel(/^Slaq/)).toHaveValue(/^ehmed-teskilat-/);
    await dialog.getByRole('button', { name: 'Yarat' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name })).toBeVisible();
  });
});
