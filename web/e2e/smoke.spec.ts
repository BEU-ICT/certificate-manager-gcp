import { expect, test } from '@playwright/test';

test('unknown route shows the localized 404 page', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Səhifə tapılmadı' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'az');
});

test('language can be switched without a reload', async ({ page }) => {
  await page.goto('/no-such-page');
  await page.getByRole('combobox').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('login page renders and is not indexed', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Daxil ol' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});

test('API starts with in-process adapters and reports healthy', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:8080/internal/healthz');
  expect(response.ok()).toBe(true);
});
