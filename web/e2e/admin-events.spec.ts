import { expect, test } from '@playwright/test';

// Needs the Auth emulator and a seeded administrator (#61); see web/README.md (Testing).
// The locale is az-AZ (playwright.config.ts).
const emulator = process.env['E2E_AUTH_EMULATOR'] === 'true';
const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? '';
const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';

test.describe('events (signed in as administrator)', () => {
  test.skip(
    !emulator || !adminEmail || !adminPassword,
    'needs the Auth emulator, the seeded admin (#61) and VITE_USE_AUTH_EMULATOR=true; see web/README.md (Testing)',
  );

  test('creates an organization and an event in it', async ({ page }) => {
    await page.goto('/admin/organizations');
    await page.getByLabel(/^E-poçt/).fill(adminEmail);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await expect(page).toHaveURL(/\/admin\/organizations$/);

    const suffix = Date.now().toString(36);
    const orgName = `Org ${suffix}`;
    await page.getByRole('button', { name: 'Yeni təşkilat' }).first().click();
    const orgDialog = page.getByRole('dialog');
    await orgDialog.getByLabel(/^Ad/).fill(orgName);
    await orgDialog.getByRole('button', { name: 'Yarat' }).click();
    await expect(orgDialog).toBeHidden();

    await page.goto('/admin/events');
    await expect(page.getByRole('heading', { name: 'Tədbirlər', level: 1 })).toBeVisible();
    const eventName = `DevFest ${suffix}`;
    await page.getByRole('button', { name: 'Yeni tədbir' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Təşkilat/).selectOption({ label: orgName });
    await dialog.getByLabel(/^Ad/).fill(eventName);
    await dialog.getByRole('button', { name: 'Yarat' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: eventName })).toBeVisible();
  });
});
