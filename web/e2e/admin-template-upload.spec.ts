import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Needs the dev stack: Auth emulator, seeded administrator and the API (BEU-ICT/certificate-manager#280);
// see web/README.md (Testing). The locale is az-AZ (playwright.config.ts).
const emulator = process.env['E2E_AUTH_EMULATOR'] === 'true';
const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? '';
const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';
const goodPackage = fileURLToPath(
  new URL('../../api/test/fixtures/templates/good', import.meta.url),
);

test.describe('template upload (signed in as administrator)', () => {
  test.skip(
    !emulator || !adminEmail || !adminPassword,
    'needs the dev stack, the seeded admin (BEU-ICT/certificate-manager#280) and VITE_USE_AUTH_EMULATOR=true; see web/README.md (Testing)',
  );

  test('uploads the good fixture package into a new event', async ({ page }) => {
    await page.goto('/admin/organizations');
    await page.getByLabel(/^E-poçt/).fill(adminEmail);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
    await expect(page).toHaveURL(/\/admin\/organizations$/);

    const suffix = Date.now().toString(36);
    const orgName = `Org ${suffix}`;
    await page.getByRole('button', { name: 'Yeni təşkilat' }).first().click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Ad/).fill(orgName);
    await dialog.getByRole('button', { name: 'Yarat' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/admin/events');
    const eventName = `Event ${suffix}`;
    await page.getByRole('button', { name: 'Yeni tədbir' }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Təşkilat/).selectOption({ label: orgName });
    await dialog.getByLabel(/^Ad/).fill(eventName);
    await dialog.getByRole('button', { name: 'Yarat' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/admin/templates/new');
    await page.getByLabel(/^Təşkilat/).selectOption({ label: orgName });
    await page.getByLabel(/^Tədbir/).selectOption({ label: eventName });
    await page.getByLabel(/^Növ/).selectOption('attendance');
    // The folder input; Playwright uploads the directory with its relative paths.
    await page.getByLabel('Qovluq seç').setInputFiles(goodPackage);
    await page.getByRole('button', { name: 'Yüklə', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Şablon yükləndi' })).toBeVisible();
    await page.getByRole('button', { name: 'Şablonu aç' }).click();
    await expect(page).toHaveURL(/\/admin\/templates\/.+-v0$/);
  });
});
