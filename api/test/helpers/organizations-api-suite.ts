/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { createFakes, fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import type { Services } from '../../src/wiring.js';

/**
 * Behaviour of `/api/v1/admin/organizations`, run against in-memory fakes (unit) and against the
 * Firestore adapter on the emulator (integration). `makePorts` returns fresh, empty ports.
 */
export function describeOrganizationsApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };

  async function setup(): Promise<{ app: FastifyInstance; services: Services }> {
    const ports = await makePorts();
    const services = buildServices(ports);
    app = buildApp({ ports, services });
    return { app, services };
  }
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app!.inject({
      method,
      url: `/api/v1/admin${url}`,
      headers: admin,
      ...(payload !== undefined && { payload: payload as object }),
    });
  const create = async (body: object) => (await call('POST', '/organizations', body)).json();

  describe(`organizations API: ${name}`, () => {
    it('creates with a generated slug (201, DTO shape, not cacheable)', async () => {
      await setup();
      const res = await call('POST', '/organizations', { name: 'Şəki Texniki Universiteti' });
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toEqual({
        id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        name: 'Şəki Texniki Universiteti',
        slug: 'seki-texniki-universiteti',
        createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      });
    });

    it('creates with a provided slug; names are trimmed and angle brackets are kept as text', async () => {
      await setup();
      const body = await create({ name: '  <b>Acme</b>  ', slug: 'acme-corp' });
      expect(body).toMatchObject({ name: '<b>Acme</b>', slug: 'acme-corp' });
    });

    it('duplicate slug: 409 CONFLICT with a suggestion, nothing created', async () => {
      await setup();
      await create({ name: 'Acme' });
      const res = await call('POST', '/organizations', { name: 'Acme' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: 'CONFLICT',
        details: [{ path: 'slug', message: 'SLUG_TAKEN', suggestion: 'acme-2' }],
      });
      const retry = await call('POST', '/organizations', { name: 'Acme', slug: 'acme-2' });
      expect(retry.statusCode).toBe(201);
      expect((await call('GET', '/organizations')).json().items).toHaveLength(2);
    });

    it.each([
      ['empty name', { name: '' }],
      ['whitespace name', { name: '   ' }],
      ['name too long', { name: 'a'.repeat(121) }],
      ['name without letters and no slug', { name: '🎉🎉' }],
      ['invalid slug', { name: 'Acme', slug: 'Not Valid' }],
      ['unknown property', { name: 'Acme', createdAt: '2020-01-01T00:00:00Z' }],
      ['non-string name', { name: 42 }],
      ['missing name', {}],
    ])('rejects %s with 400 VALIDATION_FAILED', async (_title, body) => {
      await setup();
      const res = await call('POST', '/organizations', body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('gets one organization; unknown and malformed ids are 404', async () => {
      await setup();
      const created = await create({ name: 'Acme' });
      expect((await call('GET', `/organizations/${created.id}`)).json()).toEqual(created);
      for (const id of ['missing-id', 'a%20b', 'x'.repeat(64)]) {
        const res = await call('GET', `/organizations/${id}`);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
      }
    });

    it('patch renames only the name; slug in the body is a 400', async () => {
      await setup();
      const created = await create({ name: 'Acme' });
      const res = await call('PATCH', `/organizations/${created.id}`, { name: 'Acme Inc' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: created.id, name: 'Acme Inc', slug: 'acme' });
      expect(res.json().createdAt).toBe(created.createdAt);
      const withSlug = await call('PATCH', `/organizations/${created.id}`, {
        name: 'X',
        slug: 'other',
      });
      expect(withSlug.statusCode).toBe(400);
      expect((await call('GET', `/organizations/${created.id}`)).json().slug).toBe('acme');
      expect((await call('PATCH', '/organizations/missing-id', { name: 'x' })).statusCode).toBe(
        404,
      );
      expect((await call('PATCH', `/organizations/${created.id}`, { name: '' })).statusCode).toBe(
        400,
      );
    });

    it('delete: blocked with counts while referenced, allowed afterwards, then 404', async () => {
      const { services } = await setup();
      const created = await create({ name: 'Acme' });
      let certificates = 2;
      // The `events` and `templates` checkers are registered by buildServices; certificates register theirs later.
      services.organizationReferences.register({
        name: 'certificates',
        countReferences: () => Promise.resolve(certificates),
      });
      const blocked = await call('DELETE', `/organizations/${created.id}`);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.details).toEqual([
        {
          path: 'references',
          message: 'IN_USE',
          counts: { events: 0, templates: 0, certificates: 2 },
        },
      ]);
      certificates = 0;
      const deleted = await call('DELETE', `/organizations/${created.id}`);
      expect(deleted.statusCode).toBe(204);
      expect(deleted.body).toBe('');
      expect((await call('GET', `/organizations/${created.id}`)).statusCode).toBe(404);
      expect((await call('DELETE', `/organizations/${created.id}`)).statusCode).toBe(404);
      expect((await call('POST', '/organizations', { name: 'Acme' })).statusCode).toBe(201);
    });

    it('lists by name with cursor pagination: default 25, max 50, 51 is a 400', async () => {
      await setup();
      for (let i = 0; i < 30; i++) await create({ name: `Org ${String(i).padStart(2, '0')}` });
      const first = (await call('GET', '/organizations')).json();
      expect(first.items).toHaveLength(25);
      expect(first.items[0].name).toBe('Org 00');
      const second = (await call('GET', `/organizations?cursor=${first.nextCursor}`)).json();
      expect(second.items.map((o: { name: string }) => o.name)).toEqual(
        Array.from({ length: 5 }, (_, i) => `Org ${25 + i}`),
      );
      expect(second.nextCursor).toBeNull();
      expect((await call('GET', '/organizations?limit=50')).json().items).toHaveLength(30);
      for (const query of ['limit=51', 'limit=0', 'limit=abc', 'cursor=!!!', 'unknown=1']) {
        expect((await call('GET', `/organizations?${query}`)).statusCode).toBe(400);
      }
    });

    it('answers 401 without a token and 403 for non-admins on every admin route', async () => {
      const { app: ready } = await setup();
      let seen = 0;
      await forEachAdminRoute(ready, async (route) => {
        if (!route.url.includes('/organizations')) return;
        seen += 1;
        const url = route.concreteUrl;
        const none = await ready.inject({ method: route.method as 'GET', url });
        const user = await ready.inject({
          method: route.method as 'GET',
          url,
          headers: { authorization: `Bearer ${fakeToken('u1')}` },
        });
        expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
      });
      expect(seen).toBe(5);
    });
  });
}

export { createFakes };
