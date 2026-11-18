import { expect, test } from '@playwright/test';

// Runs only in the on-prem smoke job (playwright.onprem.config.ts): the web build uses
// VITE_AUTH_PROVIDER=oidc and Keycloak holds the realm user created from ADMIN_EMAIL / ADMIN_PASSWORD
// of .env.onprem (the workflow exports them).
const email = process.env['ADMIN_EMAIL'] ?? '';
const password = process.env['ADMIN_PASSWORD'] ?? '';

test.skip(!email || !password, 'needs the on-prem stack and ADMIN_EMAIL / ADMIN_PASSWORD');

test('administrator signs in through Keycloak (code + PKCE) and signs out again', async ({
  page,
}) => {
  await page.goto('/admin');
  // The guard sends the visitor to the SSO login page; there is no password field in the SPA.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Vahid giriş ilə davam et' }).click();

  // Keycloak login form; the authorization request must be code + PKCE.
  await expect(page).toHaveURL(/\/realms\/certificate-manager\/protocol\/openid-connect\/auth\?/);
  const authorize = new URL(page.url()).searchParams;
  expect(authorize.get('response_type')).toBe('code');
  expect(authorize.get('code_challenge_method')).toBe('S256');
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();

  // Back on the SPA: the API accepted the Keycloak token and confirmed the admin role.
  await expect(page).toHaveURL(/\/admin$/);
  const signOut = page.getByRole('button', { name: 'Çıxış' });
  await expect(signOut).toBeVisible();

  await signOut.click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});
