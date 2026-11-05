/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import { asEventId, asOrganizationId } from '../../src/shared/ids.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import type { Services } from '../../src/wiring.js';

/**
 * Behaviour of `/api/v1/admin/events`, run against in-memory fakes (unit) and against the
 * Firestore adapters on the emulator (integration). `makePorts` returns fresh, empty ports.
 */
export function describeEventsApi(name: string, makePorts: () => Promise<Fakes> | Fakes): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };

  async function setup(): Promise<{ app: FastifyInstance; services: Services; fakes: Fakes }> {
    const fakes = await makePorts();
    const services = buildServices(fakes);
    app = buildApp({ ports: fakes, services });
    return { app, services, fakes };
  }
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app!.inject({
      method,
      url: `/api/v1/admin${url}`,
      headers: admin,
      ...(payload !== undefined && { payload: payload as object }),
    });
  const createOrg = async (name: string) =>
    (await call('POST', '/organizations', { name })).json().id as string;
  const createEvent = async (body: object) => (await call('POST', '/events', body)).json();

  describe(`events API: ${name}`, () => {
    it('creates an event: generated slug, default language az, organization name resolved', async () => {
      await setup();
      const organizationId = await createOrg('Acme');
      const res = await call('POST', '/events', { organizationId, name: 'DevFest 2026' });
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toEqual({
        id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        organizationId,
        organizationName: 'Acme',
        name: 'DevFest 2026',
        slug: 'devfest-2026',
        emailLanguage: 'az',
        createdAt: expect.stringMatching(/Z$/),
        updatedAt: expect.stringMatching(/Z$/),
      });
    });

    it('accepts a provided slug and the English language', async () => {
      await setup();
      const organizationId = await createOrg('Acme');
      const body = await createEvent({
        organizationId,
        name: 'Summit',
        slug: 'summit-26',
        emailLanguage: 'en',
      });
      expect(body).toMatchObject({ slug: 'summit-26', emailLanguage: 'en' });
    });

    it('unknown organization: 404 with details.path organizationId', async () => {
      await setup();
      const res = await call('POST', '/events', { organizationId: 'missing-org', name: 'Summit' });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({
        code: 'NOT_FOUND',
        details: [{ path: 'organizationId', message: 'NOT_FOUND' }],
      });
    });

    it('slug unique within the organization (409 + suggestion), free in another one (201)', async () => {
      await setup();
      const a = await createOrg('Acme');
      const b = await createOrg('Other');
      await createEvent({ organizationId: a, name: 'DevFest 2026' });
      const dup = await call('POST', '/events', { organizationId: a, name: 'DevFest 2026' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.details).toEqual([
        { path: 'slug', message: 'SLUG_TAKEN', suggestion: 'devfest-2026-2' },
      ]);
      const elsewhere = await call('POST', '/events', { organizationId: b, name: 'DevFest 2026' });
      expect(elsewhere.statusCode).toBe(201);
    });

    it.each([
      ['empty name', { name: '' }],
      ['name too long', { name: 'a'.repeat(121) }],
      ['no slug derivable', { name: '🎉🎉' }],
      ['invalid slug', { name: 'Summit', slug: 'Bad Slug' }],
      ['unknown language', { name: 'Summit', emailLanguage: 'ru' }],
      ['unknown property', { name: 'Summit', createdAt: '2020-01-01T00:00:00Z' }],
      ['missing name', {}],
    ])('rejects %s with 400 VALIDATION_FAILED', async (_title, extra) => {
      await setup();
      const organizationId = await createOrg('Acme');
      const res = await call('POST', '/events', { organizationId, ...extra });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('gets one event; unknown and malformed ids are 404', async () => {
      await setup();
      const organizationId = await createOrg('Acme');
      const created = await createEvent({ organizationId, name: 'Summit' });
      expect((await call('GET', `/events/${created.id}`)).json()).toEqual(created);
      expect((await call('GET', '/events/missing-id')).statusCode).toBe(404);
      expect((await call('GET', '/events/a%20b')).statusCode).toBe(404);
    });

    it('patch changes name and language; slug, organization or an empty body are 400', async () => {
      await setup();
      const organizationId = await createOrg('Acme');
      const created = await createEvent({ organizationId, name: 'DevFest' });
      const res = await call('PATCH', `/events/${created.id}`, {
        name: 'DevFest 2026',
        emailLanguage: 'en',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        slug: 'devfest',
        name: 'DevFest 2026',
        emailLanguage: 'en',
        organizationId,
      });
      for (const body of [{ slug: 'x1' }, { organizationId: 'other' }, {}, { name: '' }]) {
        expect((await call('PATCH', `/events/${created.id}`, body)).statusCode).toBe(400);
      }
      expect((await call('PATCH', '/events/missing-id', { name: 'x' })).statusCode).toBe(404);
    });

    it('lists with an organization filter, newest first, batched organization names, pagination', async () => {
      const { fakes } = await setup();
      const a = await createOrg('Acme');
      const b = await createOrg('Other');
      const ids: string[] = [];
      for (let i = 0; i < 28; i++) {
        (fakes.clock as { advance?: (ms: number) => void }).advance?.(1000);
        ids.push((await createEvent({ organizationId: a, name: `Event ${i}` })).id);
        // the emulator-backed run uses the fake clock too (createFakes), so createdAt strictly increases
      }
      await createEvent({ organizationId: b, name: 'Elsewhere' });
      const first = (await call('GET', `/events?organizationId=${a}`)).json();
      expect(first.items).toHaveLength(25);
      expect(first.items[0].id).toBe(ids[27]);
      expect(
        first.items.every((e: { organizationName: string }) => e.organizationName === 'Acme'),
      ).toBe(true);
      const second = (
        await call('GET', `/events?organizationId=${a}&cursor=${first.nextCursor}`)
      ).json();
      expect(second.items.map((e: { id: string }) => e.id)).toEqual([ids[2], ids[1], ids[0]]);
      expect(second.nextCursor).toBeNull();
      const all = (await call('GET', '/events?limit=50')).json();
      expect(all.items).toHaveLength(29);
      expect(
        new Set(all.items.map((e: { organizationName: string }) => e.organizationName)),
      ).toEqual(new Set(['Acme', 'Other']));
      for (const query of ['limit=51', 'limit=0', 'cursor=!!!', 'unknown=1']) {
        expect((await call('GET', `/events?${query}`)).statusCode).toBe(400);
      }
      expect((await call('GET', '/events?organizationId=missing-org')).json().items).toEqual([]);
    });

    it('delete: blocked with counts while templates/certificates reference it, then allowed', async () => {
      const { fakes } = await setup();
      const organizationId = await createOrg('Acme');
      const created = await createEvent({ organizationId, name: 'DevFest' });
      const free = await createEvent({ organizationId, name: 'Free' });
      // The `templates` and `certificates` checkers are registered by buildServices.
      await fakes.certificates.create(
        sampleCertificate({
          organizationId: asOrganizationId(organizationId),
          eventId: asEventId(created.id),
        }),
      );
      const blocked = await call('DELETE', `/events/${created.id}`);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.details).toEqual([
        { path: 'references', message: 'IN_USE', counts: { templates: 0, certificates: 1 } },
      ]);
      expect((await call('DELETE', `/events/${created.id}`)).statusCode).toBe(409);
      expect((await call('DELETE', `/events/${free.id}`)).statusCode).toBe(204);
      expect((await call('GET', `/events/${free.id}`)).statusCode).toBe(404);
      expect((await call('DELETE', `/events/${free.id}`)).statusCode).toBe(404);
    });

    it('an organization with events cannot be deleted until the events are gone', async () => {
      await setup();
      const organizationId = await createOrg('Acme');
      const created = await createEvent({ organizationId, name: 'DevFest' });
      const blocked = await call('DELETE', `/organizations/${organizationId}`);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.details[0].counts.events).toBe(1);
      await call('DELETE', `/events/${created.id}`);
      expect((await call('DELETE', `/organizations/${organizationId}`)).statusCode).toBe(204);
    });

    it('answers 401 without a token and 403 for non-admins on every events route', async () => {
      const { app: ready } = await setup();
      let seen = 0;
      await forEachAdminRoute(ready, async (route) => {
        if (!route.url.includes('/events')) return;
        seen += 1;
        const none = await ready.inject({ method: route.method as 'GET', url: route.concreteUrl });
        const user = await ready.inject({
          method: route.method as 'GET',
          url: route.concreteUrl,
          headers: { authorization: `Bearer ${fakeToken('u1')}` },
        });
        expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
      });
      expect(seen).toBe(5);
    });
  });
}
