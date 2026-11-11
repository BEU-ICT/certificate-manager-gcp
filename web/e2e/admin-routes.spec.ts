import { expect, test } from '@playwright/test';

// The tests that sign in need the Firebase Auth emulator and a seeded administrator (`npm run seed:dev`); see web/README.md (Testing). The signed-out test runs everywhere.
const emulator = process.env['E2E_AUTH_EMULATOR'] === 'true';
const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? '';
const adminPassword = process.env['E2E_ADMIN_PASSWORD'] ?? '';

test('a signed-out visitor is redirected to /login and nothing of the admin area is requested', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  await page.goto('/admin/certificates');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Daxil ol' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

  expect(requested.filter((url) => url.includes('/api/v1/admin'))).toEqual([]);
  expect(requested.filter((url) => /AdminRoutes/.test(url))).toEqual([]);
});

test.describe('with the Auth emulator and a seeded administrator', () => {
  test.skip(
    !emulator || !adminEmail || !adminPassword,
    'needs the Auth emulator, the seeded admin (npm run seed:dev) and VITE_USE_AUTH_EMULATOR=true; see web/README.md (Testing)',
  );

  async function signIn(page: import('@playwright/test').Page) {
    await page.getByLabel(/^E-poçt/).fill(adminEmail);
    await page.locator('input[autocomplete="current-password"]').fill(adminPassword);
    await page.getByRole('button', { name: 'Daxil ol' }).click();
  }

  test('returns to the requested page after login; admin code and data load only after /admin/me', async ({
    page,
  }) => {
    const order: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/v1/admin/me')) order.push('me');
      else if (url.includes('/api/v1/admin')) order.push('admin-data');
      else if (/AdminRoutes/.test(url)) order.push('admin-chunk');
    });

    await page.goto('/admin/certificates');
    await expect(page).toHaveURL(/\/login$/);
    expect(order).toEqual([]);

    await signIn(page);
    await expect(page).toHaveURL(/\/admin\/certificates$/);
    await expect(page.getByText(adminEmail)).toBeVisible();
    expect(order.slice(0, 2)).toEqual(['me', 'admin-chunk']);
    expect(order.indexOf('admin-data')).not.toBe(0);
  });

  test('sign-out returns to /login and the admin area needs a new login', async ({ page }) => {
    await page.goto('/login');
    await signIn(page);
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole('button', { name: 'Çıxış' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/admin/events');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signing out in one tab signs out the other', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'az-AZ' });
    const first = await context.newPage();
    await first.goto('/login');
    await signIn(first);
    await expect(first).toHaveURL(/\/admin$/);

    const second = await context.newPage();
    await second.goto('/admin');
    await expect(second.getByText(adminEmail)).toBeVisible();

    await first.getByRole('button', { name: 'Çıxış' }).click();
    await expect(second).toHaveURL(/\/login/);
    await context.close();
  });
});
