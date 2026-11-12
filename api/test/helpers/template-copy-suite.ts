// Routes with a happy-path test in this file (checked by test/unit/authz-matrix.test.ts):
// happy-path: POST /api/v1/admin/templates/:reference/copy
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { TemplateConfig } from '../../src/modules/templates/index.js';
import { buildServices } from '../../src/services.js';
import { UnavailableError } from '../../src/shared/errors.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';

const config = { page: 'A4', locale: 'az' } as unknown as TemplateConfig;
const FILES = [
  { path: 'background.svg', body: Buffer.from('<svg/>') },
  { path: 'fonts/main.ttf', body: Buffer.from('ttf-bytes') },
  { path: 'assets/logo.png', body: Buffer.from('png') },
];

/**
 * Behaviour of `POST /api/v1/admin/templates/{reference}/copy`, run against in-memory fakes (unit)
 * and the Firestore adapters on the emulator (integration); the storage is always in memory.
 */
export function describeTemplateCopyApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });
  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
  const errorLogs: Record<string, unknown>[] = [];

  async function setup() {
    errorLogs.length = 0;
    const fakes = await makePorts();
    const services = buildServices(fakes, undefined, {
      logger: { info: () => undefined, error: (obj) => void errorLogs.push(obj) },
    });
    app = buildApp({ ports: fakes, services, log: { level: 'silent' } });
    const org = await services.organizations.create({ name: 'Acme', slug: 'acme' });
    const other = await services.organizations.create({ name: 'Other', slug: 'other' });
    const event = await services.events.create({
      organizationId: org.id,
      name: 'DevFest',
      slug: 'devfest',
    });
    const event2 = await services.events.create({
      organizationId: org.id,
      name: 'Summit',
      slug: 'summit',
    });
    const otherEvent = await services.events.create({
      organizationId: other.id,
      name: 'Meetup',
      slug: 'meetup',
    });
    const source = await services.templates.publish({
      organizationId: org.id,
      eventId: event.id,
      organizationSlug: 'acme',
      eventSlug: 'devfest',
      type: 'attendance',
      config,
      files: FILES,
      createdBy: 'admin-0',
    });
    const storage = fakes.storage as unknown as {
      objects: Map<string, unknown>;
      copy: (...args: unknown[]) => Promise<void>;
    };
    const copy = (body: unknown, reference: string = source.reference, headers = admin) =>
      app!.inject({
        method: 'POST',
        url: `/api/v1/admin/templates/${reference}/copy`,
        headers,
        payload: body as object,
      });
    const stored = () => [...storage.objects.keys()].sort();
    return { services, org, other, event, event2, otherEvent, source, storage, copy, stored };
  }

  describe(`template copy API: ${name}`, () => {
    it('copies to another event: next reference, identical file set, config unchanged', async () => {
      const { copy, org, event2, services, source, storage, stored } = await setup();
      const before = stored();
      const res = await copy({ organizationId: org.id, eventId: event2.id });
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json();
      const storedConfig = storage.objects.get(
        'templates:templates/acme-summit-attendance-v0/config.json',
      ) as { body: Buffer };
      expect(body).toEqual({
        reference: 'acme-summit-attendance-v0',
        version: 0,
        organizationId: org.id,
        eventId: event2.id,
        type: 'attendance',
        config: source.config,
        files: [
          { path: 'assets/logo.png', size: 3 },
          { path: 'background.svg', size: 6 },
          { path: 'config.json', size: storedConfig.body.length },
          { path: 'fonts/main.ttf', size: 9 },
        ],
        warnings: [],
        createdAt: expect.stringMatching(/Z$/),
        copiedFrom: source.reference,
      });
      expect(JSON.parse(storedConfig.body.toString('utf8'))).toEqual(source.config);
      const added = stored().filter((k) => !before.includes(k));
      expect(added.map((k) => k.replace('acme-summit-attendance-v0', 'X'))).toEqual(
        before.map((k) => k.replace('acme-devfest-attendance-v0', 'X')),
      );
      // The source is untouched.
      expect(stored().filter((k) => before.includes(k))).toEqual(before);
      expect(await services.templates.get(source.reference)).toEqual(source);
      expect(await services.templates.get('acme-summit-attendance-v0')).toMatchObject({
        eventId: event2.id,
        createdBy: 'admin-1',
      });
    });

    it('changes the type when asked and starts that type at v0', async () => {
      const { copy, org, event } = await setup();
      const res = await copy({ organizationId: org.id, eventId: event.id, type: 'thanks' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        reference: 'acme-devfest-thanks-v0',
        type: 'thanks',
        copiedFrom: 'acme-devfest-attendance-v0',
      });
    });

    it('copying to the same organization, event and type creates the next version', async () => {
      const { copy, org, event } = await setup();
      const res = await copy({ organizationId: org.id, eventId: event.id });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ reference: 'acme-devfest-attendance-v1', version: 1 });
      const again = await copy({ organizationId: org.id, eventId: event.id });
      expect(again.json().reference).toBe('acme-devfest-attendance-v2');
    });

    it('answers 404 for a missing or malformed source and stores nothing', async () => {
      const { copy, org, event, stored } = await setup();
      const before = stored();
      for (const reference of ['acme-devfest-attendance-v9', 'Not%20A%20Ref']) {
        const res = await copy({ organizationId: org.id, eventId: event.id }, reference);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('NOT_FOUND');
      }
      expect(stored()).toEqual(before);
    });

    it('validates the target: 404 unknown parents, 422 mismatch, 400 bad body', async () => {
      const { copy, org, other, event, otherEvent, stored } = await setup();
      const before = stored();
      expect((await copy({ organizationId: org.id, eventId: 'bad id!' })).statusCode).toBe(400);
      const unknownOrg = await copy({ organizationId: 'a'.repeat(20), eventId: event.id });
      expect(unknownOrg.statusCode).toBe(404);
      const unknownEvent = await copy({ organizationId: org.id, eventId: 'b'.repeat(20) });
      expect(unknownEvent.statusCode).toBe(404);
      const mismatch = await copy({ organizationId: org.id, eventId: otherEvent.id });
      expect(mismatch.statusCode).toBe(422);
      expect(mismatch.json().error.code).toBe('EVENT_ORG_MISMATCH');
      expect(other.id).not.toBe(org.id);
      for (const body of [
        { organizationId: org.id, eventId: event.id, type: 'bogus' },
        { organizationId: org.id, eventId: event.id, extra: 1 },
        { organizationId: org.id },
      ]) {
        expect((await copy(body)).statusCode).toBe(400);
      }
      expect(stored()).toEqual(before);
    });

    it('cleans up and creates no document when the storage fails mid-copy', async () => {
      const { copy, org, event2, storage, stored, services } = await setup();
      const before = stored();
      const original = storage.copy.bind(storage);
      let calls = 0;
      storage.copy = (...args: unknown[]) => {
        calls += 1;
        return calls === 2 ? Promise.reject(new UnavailableError()) : original(...args);
      };
      const res = await copy({ organizationId: org.id, eventId: event2.id });
      expect(res.statusCode).toBe(503);
      expect(calls).toBe(2);
      expect(stored()).toEqual(before);
      expect((await services.templates.list({ eventId: event2.id })).items).toEqual([]);
      expect(errorLogs).toEqual([
        expect.objectContaining({
          reference: 'acme-summit-attendance-v0',
          copiedFrom: 'acme-devfest-attendance-v0',
          leakedObjects: 0,
        }),
      ]);
      storage.copy = original;
      expect((await copy({ organizationId: org.id, eventId: event2.id })).statusCode).toBe(201);
    });

    it('answers 401 without a token and 403 for non-admins', async () => {
      const { copy, org, event } = await setup();
      const body = { organizationId: org.id, eventId: event.id };
      expect((await copy(body, undefined, {} as typeof admin)).statusCode).toBe(401);
      const user = { authorization: `Bearer ${fakeToken('user-1', 'user')}` };
      expect((await copy(body, undefined, user)).statusCode).toBe(403);
    });
  });
}
