/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import type { Certificate } from '../../src/shared/domain.js';
import { asEventId, asOrganizationId } from '../../src/shared/ids.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';

const ORG = asOrganizationId('org-a');
const EVENT = asEventId('event-a');
const DAY = 86_400_000;

/**
 * Behaviour of `GET /api/v1/admin/stats`, run against in-memory fakes (unit) and the Firestore
 * adapter on the emulator (integration). `makePorts` must return fakes whose clock is a FakeClock.
 */
export function describeStatsApi(name: string, makePorts: () => Promise<Fakes> | Fakes): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });
  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
  const other = { authorization: `Bearer ${fakeToken('admin-2', 'admin')}` };

  async function setup(seed: Certificate[] = [], cacheSeconds = 60): Promise<Fakes> {
    const fakes = await makePorts();
    if (seed.length > 0) await fakes.certificates.createMany(seed);
    app = buildApp({
      ports: fakes,
      services: buildServices(fakes, undefined, { statsCacheSeconds: cacheSeconds }),
      adminRateLimitPerMin: 100_000,
    });
    return fakes;
  }
  const get = (query = '', headers: Record<string, string> = admin) =>
    app!.inject({ method: 'GET', url: `/api/v1/admin/stats${query}`, headers });
  const counter = (fakes: Fakes) => {
    let calls = 0;
    const repo = fakes.certificates;
    const original = repo.count.bind(repo);
    repo.count = (filter) => {
      calls += 1;
      return original(filter);
    };
    return () => calls;
  };

  describe(`GET /api/v1/admin/stats (${name})`, () => {
    it('counts certificates, e-mail states, templates, organizations and events', async () => {
      const fakes = await makePorts();
      const now = fakes.clock.now().getTime();
      const c = (over: Partial<Certificate>) =>
        sampleCertificate({ organizationId: ORG, eventId: EVENT, ...over });
      const seed = [
        c({ issuedAt: new Date(now - 1 * DAY), emailStatus: 'sent' }),
        c({ issuedAt: new Date(now - 29 * DAY), emailStatus: 'pending' }),
        c({ issuedAt: new Date(now - 45 * DAY), emailStatus: 'failed' }),
        c({
          issuedAt: new Date(now - 2 * DAY),
          emailStatus: 'skipped',
          status: 'revoked',
          revokedAt: new Date(now - DAY),
          revokeReason: 'x',
        }),
        c({ issuedAt: new Date(now - 90 * DAY), emailStatus: 'sent', status: 'revoked' }),
      ];
      await fakes.certificates.createMany(seed);
      app = buildApp({
        ports: fakes,
        services: buildServices(fakes),
        adminRateLimitPerMin: 100_000,
      });
      const res = await get();
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json();
      expect(body.generatedAt).toBe(fakes.clock.now().toISOString());
      expect(body.certificates).toEqual({
        total: 5,
        active: 3,
        revoked: 2,
        issuedLast30Days: 3,
      });
      expect(body.email).toEqual({ pending: 1, sent: 2, failed: 1, skipped: 1 });
      expect(body.templates).toEqual({ total: 0 });
      expect(body.organizations).toEqual({ total: 0 });
      expect(body.events).toEqual({ total: 0 });
    });

    it('counts organizations and events through their services', async () => {
      await setup();
      const orgRes = await app!.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers: admin,
        payload: { name: 'Acme' },
      });
      expect(orgRes.statusCode).toBe(201);
      await app!.inject({
        method: 'POST',
        url: '/api/v1/admin/events',
        headers: admin,
        payload: { organizationId: orgRes.json().id, name: 'DevFest' },
      });
      const body = (await get()).json();
      expect(body.organizations.total).toBe(1);
      expect(body.events.total).toBe(1);
    });

    it('serves a second call within the cache lifetime without database calls', async () => {
      const fakes = await setup([sampleCertificate({ organizationId: ORG, eventId: EVENT })]);
      const calls = counter(fakes);
      const first = await get();
      const afterFirst = calls();
      expect(afterFirst).toBeGreaterThan(0);
      const second = await get();
      expect(calls()).toBe(afterFirst);
      expect(second.json()).toEqual(first.json());
    });

    it('recomputes after the cache lifetime', async () => {
      const fakes = await setup();
      const calls = counter(fakes);
      await get();
      const afterFirst = calls();
      fakes.clock.advance(59_000);
      await get();
      expect(calls()).toBe(afterFirst);
      fakes.clock.advance(2_000);
      const res = await get();
      expect(calls()).toBe(afterFirst * 2);
      expect(res.json().generatedAt).toBe(fakes.clock.now().toISOString());
    });

    it('shares one computation between concurrent requests', async () => {
      const fakes = await setup();
      const calls = counter(fakes);
      const results = await Promise.all([get(), get(), get()]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(calls()).toBe(8);
    });

    it('refresh=true bypasses the cache and is limited to once per 10 s per admin', async () => {
      const fakes = await setup();
      const calls = counter(fakes);
      await get();
      expect(calls()).toBe(8);
      const refreshed = await get('?refresh=true');
      expect(refreshed.statusCode).toBe(200);
      expect(calls()).toBe(16);
      const throttled = await get('?refresh=true');
      expect(throttled.statusCode).toBe(429);
      expect(throttled.json().error.code).toBe('RATE_LIMITED');
      expect(Number(throttled.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(throttled.headers['retry-after'])).toBeLessThanOrEqual(10);
      expect(calls()).toBe(16);
      // The limit is per admin.
      expect((await get('?refresh=true', other)).statusCode).toBe(200);
      fakes.clock.advance(10_001);
      expect((await get('?refresh=true')).statusCode).toBe(200);
    });

    it('rejects an invalid refresh value and unknown query parameters', async () => {
      await setup();
      expect((await get('?refresh=yes')).statusCode).toBe(400);
      expect((await get('?foo=1')).statusCode).toBe(400);
    });

    it('requires an admin (auth matrix)', async () => {
      await setup();
      let seen = 0;
      await forEachAdminRoute(app!, async (route) => {
        if (!route.url.endsWith('/stats')) return;
        seen += 1;
        const none = await app!.inject({ method: route.method as 'GET', url: route.concreteUrl });
        const bad = await app!.inject({
          method: route.method as 'GET',
          url: route.concreteUrl,
          headers: { authorization: 'Basic abc' },
        });
        const user = await app!.inject({
          method: route.method as 'GET',
          url: route.concreteUrl,
          headers: { authorization: `Bearer ${fakeToken('u1')}` },
        });
        expect([none.statusCode, bad.statusCode, user.statusCode]).toEqual([401, 401, 403]);
      });
      expect(seen).toBe(1);
    });
  });
}
