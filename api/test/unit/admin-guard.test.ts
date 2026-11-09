import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import Fastify from 'fastify';
import { adminRoutes, installAdminGuard } from '../../src/http/auth/admin-guard.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { createFakes, fakeToken, type Fakes } from '../../src/testing/fakes/index.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function appWithProbe(overrides: Partial<{ fakes: Fakes; perMin: number; logs: Writable }> = {}) {
  const fakes = overrides.fakes ?? createFakes();
  const app = buildApp({
    ports: fakes,
    ...(overrides.perMin !== undefined && { adminRateLimitPerMin: overrides.perMin }),
    ...(overrides.logs && { log: { level: 'info', destination: overrides.logs } }),
  });
  adminRoutes(app, (scope) => {
    scope.get('/probe', (request) => ({ uid: request.admin?.uid }));
    scope.post('/things/:id', () => ({ ok: true }));
  });
  apps.push(app);
  return { app, fakes };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('admin guard', () => {
  it('answers 401 without a valid token and 403 for a non-admin, with identical 401 bodies', async () => {
    const { app } = appWithProbe();
    const bodies = new Set<string>();
    for (const headers of [
      {},
      { authorization: 'Basic abc' },
      { authorization: 'Bearer' },
      bearer('garbage'),
      bearer('fake:u1'),
    ]) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/probe', headers });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      const { error } = res.json<{ error: { code: string; message: string } }>();
      expect(error.code).toBe('UNAUTHENTICATED');
      bodies.add(`${error.code}|${error.message}`);
    }
    expect(bodies.size).toBe(1);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/probe',
      headers: bearer(fakeToken('u1')),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/probe',
      headers: bearer(fakeToken('u1', 'viewer')),
    });
    expect(other.statusCode).toBe(403);
  });

  it('lets an admin through and exposes request.admin', async () => {
    const { app } = appWithProbe();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/probe',
      headers: bearer(fakeToken('a1', 'admin')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ uid: 'a1' });
  });

  it('rejects an expired/revoked token', async () => {
    const { app, fakes } = appWithProbe();
    fakes.tokenVerifier.allow('t', { uid: 'a', email: 'a@example.test', role: 'admin' });
    fakes.tokenVerifier.revoke('t');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/probe',
      headers: bearer('t'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('denies everything when no verifier is configured', async () => {
    const app = buildApp();
    adminRoutes(app, (scope) => {
      scope.get('/probe', () => ({}));
    });
    apps.push(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/probe',
      headers: bearer(fakeToken('a1', 'admin')),
    });
    expect(res.statusCode).toBe(401);
  });

  it('matrix: every admin route rejects missing, malformed and non-admin credentials', async () => {
    const { app } = appWithProbe({ perMin: 10_000 }); // 4 calls per route must stay below the IP throttle;
    let count = 0;
    await forEachAdminRoute(app, async (route) => {
      count++;
      const call = (headers: Record<string, string>) =>
        app.inject({ method: route.method as 'GET', url: route.concreteUrl, headers });
      expect((await call({})).statusCode).toBe(401);
      expect((await call({ authorization: 'Bearer' })).statusCode).toBe(401);
      expect((await call(bearer(fakeToken('u1')))).statusCode).toBe(403);
      // Past the guard: the handler decides (200, 400 for a missing body, 404 for the placeholder id...).
      expect([401, 403]).not.toContain((await call(bearer(fakeToken('a1', 'admin')))).statusCode);
    });
    expect(count).toBeGreaterThanOrEqual(3); // /me, the two probes and every resource route
  });

  it('throttles by IP before verifying tokens', async () => {
    const { app, fakes } = appWithProbe({ perMin: 2 });
    let calls = 0;
    const original = fakes.tokenVerifier.verify.bind(fakes.tokenVerifier);
    fakes.tokenVerifier.verify = (t) => {
      calls++;
      return original(t);
    };
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/probe',
        headers: bearer('random'),
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([401, 401, 429, 429]);
    expect(calls).toBe(2);
  });

  it('logs successes and failures with uid, route and requestId but never token or email', async () => {
    const lines: string[] = [];
    const logs = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const { app } = appWithProbe({ logs });
    await app.inject({
      method: 'GET',
      url: '/api/v1/admin/probe',
      headers: bearer('secret-token-1'),
    });
    await app.inject({
      method: 'GET',
      url: '/api/v1/admin/probe',
      headers: bearer(fakeToken('a1', 'admin')),
    });
    const text = lines.join('');
    expect(text).toContain('admin authentication failed');
    expect(text).toContain('admin authenticated');
    expect(text).toContain('/api/v1/admin/probe');
    expect(text).toContain('a1');
    expect(text).not.toContain('secret-token-1');
    expect(text).not.toContain('fake:a1:admin');
    expect(text).not.toContain('@example.test');
  });
});

describe('admin route registration', () => {
  it('aborts boot when a route under /api/v1/admin bypasses adminRoutes()', async () => {
    const app = buildApp({ ports: createFakes() });
    app.get('/api/v1/admin/oops', () => ({}));
    apps.push(app);
    await expect(app.ready()).rejects.toThrow(/GET \/api\/v1\/admin\/oops/);
  });

  it('aborts boot for a plugin with its own admin prefix', async () => {
    const app = buildApp({ ports: createFakes() });
    void app.register(
      (scope, _opts, done) => {
        scope.get('/sneaky', () => ({}));
        done();
      },
      { prefix: '/api/v1/admin/x' },
    );
    apps.push(app);
    await expect(app.ready()).rejects.toThrow(/sneaky/);
  });

  it('boots with guarded routes only and ignores other prefixes', async () => {
    const { app } = appWithProbe();
    app.get('/api/v1/public/ok', () => ({}));
    await expect(app.ready()).resolves.toBeDefined();
  });

  it('forEachAdminRoute fails on an app without admin routes', async () => {
    const app = Fastify();
    installAdminGuard(app);
    apps.push(app);
    await expect(forEachAdminRoute(app, () => undefined)).rejects.toThrow(/no admin routes/);
  });
});
