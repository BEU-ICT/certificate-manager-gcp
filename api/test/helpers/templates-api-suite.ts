/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { TemplateConfig } from '../../src/modules/templates/index.js';
import { buildServices } from '../../src/services.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import type { Services } from '../../src/wiring.js';

const config = { page: 'A4', locale: 'az' } as unknown as TemplateConfig;
const files = [
  { path: 'background.svg', body: Buffer.from('<svg/>') },
  { path: 'fonts/main.ttf', body: Buffer.from('ttf-bytes') },
];

/**
 * Behaviour of `GET /api/v1/admin/templates[/{reference}]`, run against in-memory fakes (unit)
 * and against the Firestore adapters on the emulator (integration).
 */
export function describeTemplatesApi(name: string, makePorts: () => Promise<Fakes> | Fakes): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
  const counts = new Map<string, number>();

  async function setup() {
    counts.clear();
    const fakes = await makePorts();
    const services: Services = buildServices(fakes, {
      countByTemplate: (reference) => Promise.resolve(counts.get(reference) ?? 0),
    });
    app = buildApp({ ports: fakes, services });
    const advance = () => (fakes.clock as { advance?: (ms: number) => void }).advance?.(1000);
    const org = await services.organizations.create({ name: 'Acme', slug: 'acme' });
    const other = await services.organizations.create({ name: 'Other', slug: 'other' });
    const event = async (organizationId: string, slug: string) =>
      services.events.create({ organizationId, name: slug, slug });
    const publish = async (
      o: { id: string; slug: string },
      e: { id: string; slug: string },
      type: string,
    ) => {
      advance();
      return services.templates.publish({
        organizationId: o.id as never,
        eventId: e.id as never,
        organizationSlug: o.slug,
        eventSlug: e.slug,
        type: type as never,
        config,
        files,
        createdBy: 'admin-1',
      });
    };
    return { fakes, services, org, other, event, publish };
  }
  const get = (url: string, headers: Record<string, string> = admin) =>
    app!.inject({ method: 'GET', url: `/api/v1/admin${url}`, headers });

  describe(`templates read API: ${name}`, () => {
    it('lists newest first with the DTO and isLatest across versions and groups', async () => {
      const { org, event, publish } = await setup();
      const e = await event(org.id, 'devfest');
      const a0 = await publish(org, e, 'attendance');
      const t0 = await publish(org, e, 'thanks');
      const a1 = await publish(org, e, 'attendance');
      const res = await get('/templates');
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json();
      expect(body.nextCursor).toBeNull();
      expect(body.items.map((t: { reference: string }) => t.reference)).toEqual([
        a1.reference,
        t0.reference,
        a0.reference,
      ]);
      expect(body.items.map((t: { isLatest: boolean }) => t.isLatest)).toEqual([true, true, false]);
      expect(body.items[0]).toEqual({
        reference: 'acme-devfest-attendance-v1',
        organizationId: org.id,
        organizationSlug: 'acme',
        eventId: e.id,
        eventSlug: 'devfest',
        type: 'attendance',
        version: 1,
        createdAt: expect.stringMatching(/Z$/),
        isLatest: true,
      });
      expect(body.items[0]).not.toHaveProperty('config');
    });

    it('filters by organization, event and type', async () => {
      const { org, other, event, publish } = await setup();
      const e1 = await event(org.id, 'devfest');
      const e2 = await event(org.id, 'summit');
      const e3 = await event(other.id, 'devfest');
      await publish(org, e1, 'attendance');
      await publish(org, e1, 'thanks');
      await publish(org, e2, 'attendance');
      await publish(other, e3, 'attendance');
      const refs = async (q: string) =>
        (await get(`/templates?${q}`)).json().items.map((t: { reference: string }) => t.reference);
      expect(await refs(`organizationId=${org.id}`)).toHaveLength(3);
      expect(await refs(`organizationId=${other.id}`)).toEqual(['other-devfest-attendance-v0']);
      expect(await refs(`eventId=${e1.id}`)).toHaveLength(2);
      expect(await refs(`eventId=${e1.id}&type=thanks`)).toEqual(['acme-devfest-thanks-v0']);
      expect(await refs(`organizationId=${org.id}&type=attendance`)).toHaveLength(2);
      expect(await refs('organizationId=missing-org')).toEqual([]);
      expect(await refs('eventId=a%20b')).toEqual([]);
    });

    it('paginates with an opaque cursor and rejects bad query parameters', async () => {
      const { org, event, publish } = await setup();
      const e = await event(org.id, 'devfest');
      const refs: string[] = [];
      for (let i = 0; i < 27; i++) refs.push((await publish(org, e, 'attendance')).reference);
      const first = (await get('/templates')).json();
      expect(first.items).toHaveLength(25);
      expect(first.items[0].reference).toBe(refs[26]);
      expect(first.items.filter((t: { isLatest: boolean }) => t.isLatest)).toHaveLength(1);
      const second = (await get(`/templates?cursor=${first.nextCursor}`)).json();
      expect(second.items.map((t: { reference: string }) => t.reference)).toEqual([
        refs[1],
        refs[0],
      ]);
      expect(second.items.every((t: { isLatest: boolean }) => !t.isLatest)).toBe(true);
      expect(second.nextCursor).toBeNull();
      expect((await get('/templates?limit=2')).json().items).toHaveLength(2);
      for (const q of ['limit=51', 'limit=0', 'cursor=!!!', 'type=bogus', 'unknown=1']) {
        expect((await get(`/templates?${q}`)).statusCode).toBe(400);
      }
    });

    it('detail: config, files from storage, isLatest and certificateCount', async () => {
      const { org, event, publish } = await setup();
      const e = await event(org.id, 'devfest');
      const v0 = await publish(org, e, 'attendance');
      const v1 = await publish(org, e, 'attendance');
      counts.set(v0.reference, 4);
      const old = (await get(`/templates/${v0.reference}`)).json();
      expect(old).toMatchObject({
        reference: v0.reference,
        version: 0,
        isLatest: false,
        certificateCount: 4,
        config,
      });
      expect(old.files).toEqual([
        { path: 'background.svg', size: 6 },
        { path: 'config.json', size: JSON.stringify(config).length },
        { path: 'fonts/main.ttf', size: 9 },
      ]);
      const latest = (await get(`/templates/${v1.reference}`)).json();
      expect(latest).toMatchObject({ isLatest: true, certificateCount: 0 });
    });

    it('unknown and malformed references are 404', async () => {
      await setup();
      for (const ref of [
        'a'.repeat(400) + '-v1',
        'acme-devfest-attendance-v9',
        'Bad_Ref',
        'a%20b',
        '-v1',
        'x-v01',
      ]) {
        const res = await get(`/templates/${ref}`);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
      }
    });

    it('answers 401 without a token and 403 for non-admins on every templates route', async () => {
      const { app: ready } = { app: (await setup(), app!) };
      let seen = 0;
      await forEachAdminRoute(ready, async (route) => {
        if (!route.url.includes('/templates')) return;
        seen += 1;
        const none = await ready.inject({ method: route.method as 'GET', url: route.concreteUrl });
        const user = await ready.inject({
          method: route.method as 'GET',
          url: route.concreteUrl,
          headers: { authorization: `Bearer ${fakeToken('u1')}` },
        });
        expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
      });
      expect(seen).toBe(3);
    });
  });
}
