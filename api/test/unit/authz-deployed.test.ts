import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import { forEachAdminRoute, type AdminRouteCase } from '../../src/testing/admin-routes.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import { SEND_EMAIL_HANDLER } from '../../src/shared/email-task.js';

/**
 * Deployed-environment variant of the authorisation matrix (BEU-ICT/certificate-manager#398):
 * `npm run test:authz -- --base-url https://<domain>` (the script sets `AUTHZ_BASE_URL`). It sends only requests
 * that need no credentials and cannot change data: admin routes must answer 401 without a token
 * and with a malformed one, and `/internal/**` must not reach the handler through Hosting (SPA
 * HTML or 404, never the handler's 401/400/429). Skipped when no base URL is given, so the normal
 * unit run never touches the network.
 */
const BASE_URL = process.env['AUTHZ_BASE_URL']?.replace(/\/+$/u, '');

async function adminRoutes(): Promise<AdminRouteCase[]> {
  const fakes = createFakes();
  const app = buildApp({
    ports: fakes,
    services: buildServices(fakes, undefined, {
      fitChecker: { checkFit: () => Promise.resolve({ fits: true, issues: [] }) },
    }),
  });
  const routes: AdminRouteCase[] = [];
  await forEachAdminRoute(app, (r) => void routes.push(r));
  await app.close();
  return routes;
}

/** One request; a 429 is retried after `Retry-After` (the admin pre-auth budget is per IP). */
async function request(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { redirect: 'manual', ...init });
    if (res.status !== 429 || attempt >= 3) return res;
    const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 30);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

describe.skipIf(!BASE_URL)('deployed environment (no credentials)', () => {
  it('rejects every admin route without a token or with a malformed one (401)', async () => {
    const violations: string[] = [];
    for (const route of await adminRoutes()) {
      for (const [name, headers] of [
        ['no token', {}],
        ['malformed token', { authorization: 'Bearer not.a.jwt' }],
      ] as const) {
        const res = await request(`${BASE_URL!}${route.concreteUrl}`, {
          method: route.method,
          headers,
        });
        if (res.status !== 401) {
          violations.push(`${route.method} ${route.url}: ${name} -> ${String(res.status)}`);
        } else if (
          (res.headers.get('content-type') ?? '').includes('text/html') ||
          res.headers.get('www-authenticate') !== 'Bearer'
        ) {
          // A 401 from a proxy or the SPA is not the guard's answer.
          violations.push(`${route.method} ${route.url}: ${name} -> 401 not from the API guard`);
        }
      }
    }
    expect(violations).toEqual([]);
  }, 600_000);

  it('does not expose /internal/** through the public domain', async () => {
    for (const [method, path] of [
      ['POST', SEND_EMAIL_HANDLER],
      ['GET', SEND_EMAIL_HANDLER],
      ['GET', '/internal/healthz'],
      ['GET', '/internal/openapi.json'],
    ] as const) {
      const res = await request(`${BASE_URL!}${path}`, {
        method,
        ...(method === 'POST' && { headers: { 'content-type': 'application/json' }, body: '{}' }),
      });
      const type = res.headers.get('content-type') ?? '';
      const isSpaOrNotFound =
        res.status === 404 || (res.status === 200 && type.includes('text/html'));
      expect(isSpaOrNotFound, `${method} ${path} -> ${String(res.status)} ${type}`).toBe(true);
      expect(res.headers.get('www-authenticate')).toBeNull();
    }
  });
});
