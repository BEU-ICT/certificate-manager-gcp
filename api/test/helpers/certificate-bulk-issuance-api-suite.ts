/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createFeatureFlags, parseFlags } from '../../src/flags.js';
import type { FitChecker } from '../../src/modules/certificates/index.js';
import type { FitResult } from '../../src/modules/pdf/index.js';
import type { Certificate, Template } from '../../src/shared/domain.js';
import { buildServices } from '../../src/services.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import {
  sampleEvent,
  sampleOrganization,
  sampleTemplate,
} from '../../src/testing/contracts/index.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';

class FakeFitChecker implements FitChecker {
  /** Per call: the failing fields for an owner name (default: everything fits). */
  failing = new Map<string, FitResult>();
  readonly templates: Template[] = [];
  calls = 0;
  checkFit(certificate: Certificate, template: Template): Promise<FitResult> {
    this.calls += 1;
    this.templates.push(template);
    return Promise.resolve(this.failing.get(certificate.ownerName) ?? { fits: true, issues: [] });
  }
}

/**
 * Behaviour of `POST /api/v1/admin/certificates/bulk`, run against in-memory fakes (unit) and the
 * Firestore adapter on the emulator (integration).
 */
export function describeCertificateBulkIssuanceApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };

  async function setup(options: { flagOff?: boolean; logs?: Writable } = {}) {
    const fakes = await makePorts();
    const fit = new FakeFitChecker();
    const org = sampleOrganization({ name: 'Acme Org' });
    const otherOrg = sampleOrganization({ name: 'Other Org', slug: 'other-org' });
    const event = sampleEvent({ organizationId: org.id, name: 'DevFest' });
    const otherEvent = sampleEvent({ organizationId: otherOrg.id, name: 'Other Event' });
    await fakes.organizations.create(org);
    await fakes.organizations.create(otherOrg);
    await fakes.events.create(event);
    await fakes.events.create(otherEvent);
    const template = sampleTemplate({ organizationId: org.id, eventId: event.id, version: 1 });
    await fakes.templates.create(template);
    const { flags } = parseFlags(
      { FEATURE_BULK_ISSUANCE: options.flagOff ? 'false' : 'true' },
      true,
    );
    app = buildApp({
      ports: fakes,
      services: buildServices(fakes, undefined, { fitChecker: fit }),
      flags: createFeatureFlags(flags),
      adminRateLimitPerMin: 100_000,
      ...(options.logs && { log: { level: 'info' as const, destination: options.logs } }),
    });
    const body = (items: unknown[], overrides: Record<string, unknown> = {}) => ({
      organizationId: org.id,
      eventId: event.id,
      type: 'attendance',
      subject: 'Cloud workshop',
      items,
      ...overrides,
    });
    const post = (payload: unknown, headers: Record<string, string> = admin) =>
      app!.inject({
        method: 'POST',
        url: '/api/v1/admin/certificates/bulk',
        headers,
        payload: payload as object,
      });
    return { fakes, fit, org, otherOrg, event, otherEvent, template, body, post };
  }

  const people = (n: number, withEmail = true) =>
    Array.from({ length: n }, (_v, i) => ({
      ownerName: `Person ${String(i)}`,
      ...(withEmail && { email: `person${String(i)}@example.com` }),
    }));
  interface Issued {
    id: string;
    ownerName: string;
    hasEmail: boolean;
  }
  const itemsOf = (res: { json(): unknown }): Issued[] => (res.json() as { items: Issued[] }).items;
  const count = (fakes: Fakes) => fakes.certificates.count({});
  const paths = (res: { json(): unknown }): string[] =>
    (res.json() as { error: { details: { path: string }[] } }).error.details.map((d) => d.path);

  describe(`bulk certificate issuance API: ${name}`, () => {
    it('500 valid items: 201, request order, one atomic batch, 500 events in order, no e-mail in the response', async () => {
      const s = await setup();
      let createManyCalls = 0;
      let createCalls = 0;
      const repo = s.fakes.certificates;
      const many = repo.createMany.bind(repo);
      const one = repo.create.bind(repo);
      repo.createMany = (c) => {
        createManyCalls += 1;
        return many(c);
      };
      repo.create = (c) => {
        createCalls += 1;
        return one(c);
      };
      const res = await s.post(s.body(people(500)));
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const json = res.json<{ created: number; items: Issued[] }>();
      expect(json.created).toBe(500);
      expect(json.items).toHaveLength(500);
      expect(json.items[0]).toEqual({
        id: json.items[0]!.id,
        ownerName: 'Person 0',
        hasEmail: true,
      });
      expect(json.items.map((i) => i.ownerName)).toEqual(people(500).map((p) => p.ownerName));
      expect(JSON.stringify(json)).not.toContain('@example.com');
      expect(createManyCalls).toBe(1);
      expect(createCalls).toBe(0);
      expect(await count(s.fakes)).toBe(500);
      const issued = s.fakes.eventBus.published.filter((e) => e.type === 'certificate.issued');
      expect(issued).toHaveLength(500);
      expect(issued.map((e) => (e.payload as { certificateId: string }).certificateId)).toEqual(
        json.items.map((i) => i.id),
      );
      const stored = await repo.getById(json.items[7]!.id as never);
      expect(stored).toMatchObject({
        organizationName: 'Acme Org',
        eventName: 'DevFest',
        templateId: s.template.reference,
        subject: 'Cloud workshop',
        status: 'active',
        emailStatus: 'pending',
        createdBy: 'admin-1',
      });
    });

    it('resolves the template once and reuses it for every checkFit; no per-item reads', async () => {
      const s = await setup();
      let templateReads = 0;
      for (const method of ['getByReference', 'getLatest'] as const) {
        const orig = s.fakes.templates[method].bind(s.fakes.templates) as (
          ...a: unknown[]
        ) => unknown;
        (s.fakes.templates as unknown as Record<string, unknown>)[method] = (...a: unknown[]) => {
          templateReads += 1;
          return orig(...a);
        };
      }
      let reads = 0;
      for (const [target, method] of [
        [s.fakes.organizations, 'getById'],
        [s.fakes.events, 'getById'],
        [s.fakes.certificates, 'getById'],
      ] as const) {
        const orig = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[
          method
        ]!.bind(target);
        (target as unknown as Record<string, unknown>)[method] = (...a: unknown[]) => {
          reads += 1;
          return orig(...a);
        };
      }
      expect((await s.post(s.body(people(120)))).statusCode).toBe(201);
      expect(templateReads).toBe(1);
      expect(s.fit.calls).toBe(120);
      expect(new Set(s.fit.templates).size).toBe(1);
      expect(reads).toBeLessThanOrEqual(3);
    });

    it('one invalid item among 500: 422 BULK_INVALID naming it, nothing written or published', async () => {
      const s = await setup();
      const items = people(500);
      items[137] = { ownerName: '   ', email: 'x@example.com' };
      const res = await s.post(s.body(items));
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('BULK_INVALID');
      expect(paths(res)).toEqual(['items[137].ownerName']);
      expect(res.json().error.details[0]).toMatchObject({ code: expect.any(String) });
      expect(res.json().error.truncated).toBeUndefined();
      expect(await count(s.fakes)).toBe(0);
      expect(s.fakes.eventBus.published).toHaveLength(0);
    });

    it('reports every problem across items: validation, unknown property, missing subject, fit', async () => {
      const s = await setup();
      s.fit.failing.set('Too Long', {
        fits: false,
        issues: [
          { field: 'ownerName', message: 'too long', reason: 'TEXT_DOES_NOT_FIT' },
          { field: 'subject', message: 'too long', reason: 'TEXT_DOES_NOT_FIT' },
        ],
      });
      const res = await s.post(
        s.body(
          [
            { ownerName: 'Ok' },
            { ownerName: 'Bad Mail', email: 'nope' },
            { ownerName: 'Extra', status: 'revoked' },
            { ownerName: 'No Subject' },
            { ownerName: 'Skills', skills: ['a', ' '] },
            { ownerName: 'Too Long' },
            'not an object',
            { ownerName: 'Future', issuedAt: '2999-01-01T00:00:00Z' },
          ],
          { subject: undefined },
        ),
      );
      // Items 0, 2, 5 and 7 get no common subject; only 3 lacks any: see below with a subject.
      expect(res.statusCode).toBe(422);
      const got = paths(res);
      expect(got).toContain('items[1].email');
      expect(got).toContain('items[2].status');
      expect(got).toContain('items[0].subject');
      expect(got).toContain('items[4].skills[1]');
      expect(got).toContain('items[6]');
      expect(got).toContain('items[7].issuedAt');
      expect(await count(s.fakes)).toBe(0);

      const withCommon = await s.post(
        s.body([
          { ownerName: 'Ok' },
          { ownerName: 'Too Long', subject: 'Own subject' },
          { ownerName: 'Extra', status: 'x' },
        ]),
      );
      expect(paths(withCommon)).toEqual([
        'items[1].ownerName',
        'items[1].subject',
        'items[2].status',
      ]);
      const fitDetail = withCommon.json().error.details[0];
      expect(fitDetail).toMatchObject({ message: 'too long', code: 'TEXT_DOES_NOT_FIT' });
      expect(await count(s.fakes)).toBe(0);
    });

    it('per-item subject overrides the common subject; same normalisation as single issuance', async () => {
      const s = await setup();
      const res = await s.post(
        s.body([
          { ownerName: '  Aysel​   Məmmədova ', email: ' Aysel@Example.COM ', subject: 'Own' },
          { ownerName: 'Bob', skills: ['Cloud', 'cloud', 'Go'], issuedAt: '2025-12-01T10:00:00Z' },
        ]),
      );
      expect(res.statusCode).toBe(201);
      const [a, b] = await Promise.all(
        itemsOf(res).map((i) => s.fakes.certificates.getById(i.id as never)),
      );
      expect(a).toMatchObject({
        ownerName: 'Aysel Məmmədova',
        email: 'aysel@example.com',
        subject: 'Own',
      });
      expect(b).toMatchObject({
        subject: 'Cloud workshop',
        skills: ['Cloud', 'Go'],
        issuedAt: new Date('2025-12-01T10:00:00Z'),
        emailStatus: 'skipped',
      });
    });

    it('caps details at 200 with truncated: true (and not below the cap)', async () => {
      const s = await setup();
      const bad = (n: number) => Array.from({ length: n }, () => ({ ownerName: '' }));
      const over = await s.post(s.body(bad(250)));
      expect(over.statusCode).toBe(422);
      expect(over.json().error.details).toHaveLength(200);
      expect(over.json().error.truncated).toBe(true);
      expect(over.json().error.details[199].path).toBe('items[199].ownerName');
      const exact = await s.post(s.body(bad(200)));
      expect(exact.json().error.details).toHaveLength(200);
      expect(exact.json().error.truncated).toBeUndefined();
      expect(await count(s.fakes)).toBe(0);
    });

    it('duplicates of the same person are allowed; mixed e-mail and no-email statuses', async () => {
      const s = await setup();
      const res = await s.post(
        s.body([
          { ownerName: 'Same', email: 'same@example.com' },
          { ownerName: 'Same', email: 'same@example.com' },
          { ownerName: 'No Mail' },
          { ownerName: 'Blank Mail', email: '  ' },
        ]),
      );
      expect(res.statusCode).toBe(201);
      expect(itemsOf(res).map((i) => i.hasEmail)).toEqual([true, true, false, false]);
      const ids = itemsOf(res).map((i) => i.id);
      expect(new Set(ids).size).toBe(4);
      const stored = await Promise.all(ids.map((id) => s.fakes.certificates.getById(id as never)));
      expect(stored.map((c) => c?.emailStatus)).toEqual([
        'pending',
        'pending',
        'skipped',
        'skipped',
      ]);
      expect(
        s.fakes.eventBus.published.map((e) => (e.payload as { hasEmail: boolean }).hasEmail),
      ).toEqual([true, true, false, false]);
    });

    it('envelope: 0 or 501 items and unknown properties are 400, items must be an array', async () => {
      const s = await setup();
      for (const payload of [
        s.body([]),
        s.body(people(501)),
        s.body(people(1), { extra: 1 }),
        s.body(people(1), { type: 'nonsense' }),
        s.body(people(1), { organizationId: 'bad id!' }),
        s.body(people(1), { subject: '' }),
        s.body('x' as never),
        { ...s.body(people(1)), items: undefined },
      ]) {
        const res = await s.post(payload);
        expect([payload, res.statusCode, res.json().error.code]).toEqual([
          payload,
          400,
          'VALIDATION_FAILED',
        ]);
      }
      expect(await count(s.fakes)).toBe(0);
    });

    it('reference errors are 422 (whole request) or 404, nothing written', async () => {
      const s = await setup();
      const mismatch = await s.post(s.body(people(2), { eventId: s.otherEvent.id }));
      expect([mismatch.statusCode, mismatch.json().error.code]).toEqual([
        422,
        'EVENT_ORG_MISMATCH',
      ]);
      const noTemplate = await s.post(s.body(people(2), { type: 'thanks' }));
      expect([noTemplate.statusCode, noTemplate.json().error.code]).toEqual([
        422,
        'TEMPLATE_NOT_FOUND',
      ]);
      const wrongType = await s.post(
        s.body(people(2), { templateId: s.template.reference, type: 'thanks' }),
      );
      expect(wrongType.json().error.code).toBe('TEMPLATE_MISMATCH');
      expect((await s.post(s.body(people(1), { organizationId: 'missing' }))).statusCode).toBe(404);
      expect(await count(s.fakes)).toBe(0);
    });

    it('rejects a body above 1 MB with 413', async () => {
      const s = await setup();
      const res = await s.post(s.body(people(1), { subject: 'x'.repeat(1_100_000) }));
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('flag off: 404 and nothing written', async () => {
      const s = await setup({ flagOff: true });
      const res = await s.post(s.body(people(2)));
      expect([res.statusCode, res.json().error.code]).toEqual([404, 'NOT_FOUND']);
      expect(await count(s.fakes)).toBe(0);
    });

    it('idempotent replay: same items, Idempotent-Replayed, nothing created twice, IDs only stored', async () => {
      const s = await setup();
      const payload = s.body(people(30));
      const first = await s.post(payload, { ...admin, 'idempotency-key': 'bulk-1' });
      const second = await s.post(payload, { ...admin, 'idempotency-key': 'bulk-1' });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.json()).toEqual(first.json());
      expect(second.json().items).toHaveLength(30);
      expect(await count(s.fakes)).toBe(30);
      expect(s.fakes.eventBus.published).toHaveLength(30);
      const stored = JSON.stringify(
        await s.fakes.idempotency.begin({ adminUid: 'admin-1', key: 'bulk-1' }, 'x'),
      );
      expect(stored).not.toContain('example.com');
      expect(stored).not.toContain('Person');
      const other = await s.post(s.body(people(2)), { ...admin, 'idempotency-key': 'bulk-1' });
      expect([other.statusCode, other.json().error.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
    });

    it('a rejected bulk request releases the idempotency key for a corrected retry', async () => {
      const s = await setup();
      const key = { ...admin, 'idempotency-key': 'bulk-2' };
      const bad = await s.post(s.body([{ ownerName: '' }]), key);
      expect(bad.statusCode).toBe(422);
      const ok = await s.post(s.body([{ ownerName: 'Fixed' }]), key);
      // A different body with the released key is a fresh request.
      expect(ok.statusCode).toBe(201);
    });

    it('audits one certificate.bulk_issued line without names or e-mail addresses', async () => {
      const lines: string[] = [];
      const logs = new Writable({
        write(chunk: Buffer, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      });
      const s = await setup({ logs });
      await s.post(s.body(people(3)));
      const all = lines.flatMap((l) => l.split('\n'));
      const audits = all.filter((l) => l.includes('"audit":true'));
      expect(audits).toHaveLength(1);
      expect(JSON.parse(audits[0]!)).toMatchObject({
        action: 'certificate.bulk_issued',
        count: 3,
        organizationId: s.org.id,
        eventId: s.event.id,
        template: s.template.reference,
        adminUid: 'admin-1',
      });
      const text = lines.join('');
      expect(text).not.toContain('example.com');
      expect(text).not.toContain('Person');
    });

    it('auth matrix: 401 without a token, 403 for a non-admin', async () => {
      const s = await setup();
      const none = await s.post(s.body(people(1)), {});
      const user = await s.post(s.body(people(1)), { authorization: `Bearer ${fakeToken('u1')}` });
      expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
      let seen = false;
      await forEachAdminRoute(app!, async (route) => {
        if (route.method !== 'POST' || route.url !== '/api/v1/admin/certificates/bulk') return;
        seen = true;
        const a = await app!.inject({ method: 'POST', url: route.concreteUrl });
        const b = await app!.inject({
          method: 'POST',
          url: route.concreteUrl,
          headers: { authorization: `Bearer ${fakeToken('u1')}` },
        });
        expect([a.statusCode, b.statusCode]).toEqual([401, 403]);
      });
      expect(seen).toBe(true);
      expect(await count(s.fakes)).toBe(0);
    });
  });
}
