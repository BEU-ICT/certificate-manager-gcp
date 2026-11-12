/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FitChecker } from '../../src/modules/certificates/index.js';
import type { FitResult } from '../../src/modules/pdf/index.js';
import { buildServices } from '../../src/services.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import {
  sampleEvent,
  sampleOrganization,
  sampleTemplate,
} from '../../src/testing/contracts/index.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import type { Certificate, Template } from '../../src/shared/domain.js';
import { ConflictError } from '../../src/shared/errors.js';

class FakeFitChecker implements FitChecker {
  result: FitResult = { fits: true, issues: [] };
  readonly calls: { certificate: Certificate; template: Template }[] = [];
  checkFit(certificate: Certificate, template: Template): Promise<FitResult> {
    this.calls.push({ certificate, template });
    return Promise.resolve(this.result);
  }
}

/**
 * Behaviour of `POST /api/v1/admin/certificates`, run against in-memory fakes (unit) and the
 * Firestore adapter on the emulator (integration).
 */
export function describeCertificateIssuanceApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  async function setup(options: { logs?: Writable; withFitChecker?: boolean } = {}) {
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
    const tpl = (version: number, overrides: Partial<Template> = {}) =>
      sampleTemplate({ organizationId: org.id, eventId: event.id, version, ...overrides });
    const services = buildServices(fakes, undefined, {
      ...(options.withFitChecker !== false && { fitChecker: fit }),
    });
    app = buildApp({
      ports: fakes,
      services,
      adminRateLimitPerMin: 100_000,
      publicUrls: {
        publicBaseUrl: 'https://app.example.test/',
        pdfPublicBaseUrl: 'https://pdf.test',
      },
      ...(options.logs && { log: { level: 'info' as const, destination: options.logs } }),
    });
    const body = (overrides: Record<string, unknown> = {}) => ({
      organizationId: org.id,
      eventId: event.id,
      type: 'attendance',
      ownerName: 'Aysel Məmmədova',
      subject: 'Cloud workshop',
      ...overrides,
    });
    const post = (payload: unknown, headers: Record<string, string> = admin) =>
      app!.inject({
        method: 'POST',
        url: '/api/v1/admin/certificates',
        headers,
        payload: payload as object,
      });
    return { fakes, fit, org, otherOrg, event, otherEvent, tpl, body, post };
  }

  const count = async (fakes: Fakes) => fakes.certificates.count({});

  describe(`POST /api/v1/admin/certificates: ${name}`, () => {
    it('issues with an e-mail: pending, snapshots, latest template, 201 admin DTO', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1), s.tpl(2)]);
      const res = await s.post(
        s.body({ email: ' Aysel@Example.COM ', skills: ['Cloud', 'cloud', 'Go'] }),
      );
      expect(res.statusCode).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const dto = res.json();
      expect(dto).toMatchObject({
        organizationId: s.org.id,
        eventId: s.event.id,
        organizationName: 'Acme Org',
        eventName: 'DevFest',
        templateId: s.tpl(2).reference,
        type: 'attendance',
        ownerName: 'Aysel Məmmədova',
        email: 'aysel@example.com',
        skills: ['Cloud', 'Go'],
        status: 'active',
        emailStatus: 'pending',
        emailAttempts: 0,
        pdfUrl: null,
        createdBy: 'admin-1',
        issuedAt: s.fakes.clock.now().toISOString(),
        createdAt: s.fakes.clock.now().toISOString(),
        updatedAt: s.fakes.clock.now().toISOString(),
      });
      expect(dto.publicUrl).toBe(`https://app.example.test/c/${dto.id as string}`);
      const stored = await s.fakes.certificates.getById(dto.id);
      expect(stored?.emailStatus).toBe('pending');
      expect(stored?.templateId).toBe(s.tpl(2).reference);
      expect(s.fit.calls).toHaveLength(1);
    });

    it('issues without e-mail: skipped, email null, issuedAt honoured', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      const res = await s.post(s.body({ issuedAt: '2025-12-01T10:00:00Z' }));
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        email: null,
        emailStatus: 'skipped',
        skills: [],
        issuedAt: '2025-12-01T10:00:00.000Z',
      });
    });

    it('stores the organization and event name snapshots on the document', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      const id = (await s.post(s.body())).json().id as string;
      const stored = await s.fakes.certificates.getById(id as never);
      expect([stored?.organizationName, stored?.eventName]).toEqual(['Acme Org', 'DevFest']);
    });

    it('honours an explicit older template version', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1), s.tpl(2)]);
      const res = await s.post(s.body({ templateId: s.tpl(1).reference }));
      expect(res.statusCode).toBe(201);
      expect(res.json().templateId).toBe(s.tpl(1).reference);
    });

    it('422 TEMPLATE_NOT_FOUND without any template and for an unknown reference', async () => {
      const s = await setup();
      const none = await s.post(s.body());
      expect([none.statusCode, none.json().error.code]).toEqual([422, 'TEMPLATE_NOT_FOUND']);
      const unknown = await s.post(s.body({ templateId: 'nope-v3' }));
      expect([unknown.statusCode, unknown.json().error.code]).toEqual([422, 'TEMPLATE_NOT_FOUND']);
      expect(await count(s.fakes)).toBe(0);
    });

    it('422 TEMPLATE_MISMATCH names the mismatching fields', async () => {
      const s = await setup();
      const thanks = s.tpl(1, { type: 'thanks' });
      const foreign = sampleTemplate({ organizationId: s.otherOrg.id, eventId: s.otherEvent.id });
      await fakes_putTemplates(s, [thanks, foreign]);
      const byType = await s.post(s.body({ templateId: thanks.reference }));
      expect(byType.statusCode).toBe(422);
      expect(byType.json().error.code).toBe('TEMPLATE_MISMATCH');
      expect(byType.json().error.details.map((d: { path: string }) => d.path)).toEqual(['type']);
      const byOrg = await s.post(s.body({ templateId: foreign.reference }));
      expect(byOrg.json().error.code).toBe('TEMPLATE_MISMATCH');
      expect(byOrg.json().error.details.map((d: { path: string }) => d.path)).toEqual([
        'organizationId',
        'eventId',
      ]);
      expect(await count(s.fakes)).toBe(0);
    });

    it('422 EVENT_ORG_MISMATCH when the event belongs to another organization', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      const res = await s.post(s.body({ eventId: s.otherEvent.id }));
      expect([res.statusCode, res.json().error.code]).toEqual([422, 'EVENT_ORG_MISMATCH']);
      expect(await count(s.fakes)).toBe(0);
    });

    it('404 for an unknown organization or event', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      expect((await s.post(s.body({ organizationId: 'missing' }))).statusCode).toBe(404);
      expect((await s.post(s.body({ eventId: 'missing' }))).statusCode).toBe(404);
    });

    it('422 TEXT_DOES_NOT_FIT lists every failing field and creates nothing', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      s.fit.result = {
        fits: false,
        issues: [
          { field: 'ownerName', message: 'too long', reason: 'TEXT_DOES_NOT_FIT' },
          { field: 'subject', message: 'too long', reason: 'TEXT_DOES_NOT_FIT' },
        ],
      };
      const published = s.fakes.eventBus.published.length;
      const res = await s.post(s.body());
      expect([res.statusCode, res.json().error.code]).toEqual([422, 'TEXT_DOES_NOT_FIT']);
      expect(res.json().error.details.map((d: { path: string }) => d.path)).toEqual([
        'ownerName',
        'subject',
      ]);
      expect(await count(s.fakes)).toBe(0);
      expect(s.fakes.eventBus.published).toHaveLength(published);
    });

    it('stays within the read budget: <= 6 reads and exactly 1 create (explicit and latest template)', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1), s.tpl(2)]);
      const f = s.fakes;
      let reads = 0;
      let creates = 0;
      const wrap = <T extends object>(target: T, names: string[], kind: 'read' | 'create') => {
        for (const n of names) {
          const orig = (target as Record<string, (...a: unknown[]) => unknown>)[n]!.bind(target);
          (target as Record<string, unknown>)[n] = (...a: unknown[]) => {
            if (kind === 'read') reads += 1;
            else creates += 1;
            return orig(...a);
          };
        }
      };
      wrap(f.organizations, ['getById', 'getMany'], 'read');
      wrap(f.events, ['getById'], 'read');
      wrap(f.templates, ['getByReference', 'getLatest'], 'read');
      wrap(f.certificates, ['create'], 'create');
      for (const extra of [{}, { templateId: s.tpl(1).reference }]) {
        reads = 0;
        creates = 0;
        expect((await s.post(s.body(extra))).statusCode).toBe(201);
        expect(reads).toBeGreaterThan(0);
        expect(reads).toBeLessThanOrEqual(6);
        expect(creates).toBe(1);
      }
    });

    it('rejects unknown fields and invalid input with 400, creating nothing', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      for (const extra of [
        { status: 'revoked' },
        { createdBy: 'x' },
        { email: 'not-an-email' },
        { type: 'nonsense' },
        { ownerName: '' },
        { issuedAt: '2999-01-01T00:00:00Z' },
        { organizationId: 'bad id!' },
        { templateId: 'Not A Ref' },
      ]) {
        const res = await s.post(s.body(extra));
        expect([extra, res.statusCode]).toEqual([extra, 400]);
      }
      expect(await count(s.fakes)).toBe(0);
    });

    it('publishes certificate.issued once with IDs only; a throwing subscriber keeps the 201', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      const seen: unknown[] = [];
      s.fakes.eventBus.subscribe('certificate.issued', 'recorder', (p) => {
        seen.push(p);
      });
      s.fakes.eventBus.subscribe('certificate.issued', 'thrower', () => {
        throw new Error('boom');
      });
      const res = await s.post(s.body({ email: 'a@example.com' }));
      expect(res.statusCode).toBe(201);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        certificateId: res.json().id,
        organizationId: s.org.id,
        eventId: s.event.id,
        hasEmail: true,
      });
      expect(JSON.stringify(seen[0])).not.toContain('a@example.com');
      expect(s.fakes.eventBus.errors).toHaveLength(1);
    });

    it('retries once with a fresh ID after an ID collision', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      s.fakes.ids.queueCertificateIds('A'.repeat(22), 'B'.repeat(22));
      const original = s.fakes.certificates.create.bind(s.fakes.certificates);
      let attempts = 0;
      s.fakes.certificates.create = (c: Certificate) => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new ConflictError('exists'));
        return original(c);
      };
      const res = await s.post(s.body());
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe('B'.repeat(22));
      expect(attempts).toBe(2);
    });

    it('gives up after a second collision', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      s.fakes.certificates.create = () => Promise.reject(new ConflictError('exists'));
      const res = await s.post(s.body());
      expect(res.statusCode).toBe(409);
      expect(s.fakes.eventBus.published).toHaveLength(0);
    });

    it('is idempotent with Idempotency-Key: replay returns the same certificate, stores IDs only', async () => {
      const s = await setup();
      await fakes_putTemplates(s, [s.tpl(1)]);
      const payload = s.body({ email: 'a@example.com', issuedAt: '2025-12-01T10:00:00Z' });
      const first = await s.post(payload, { ...admin, 'idempotency-key': 'k1' });
      const second = await s.post(payload, { ...admin, 'idempotency-key': 'k1' });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.json()).toEqual(first.json());
      expect(await count(s.fakes)).toBe(1);
      expect(s.fakes.eventBus.published).toHaveLength(1);
      expect(
        JSON.stringify(await s.fakes.idempotency.begin({ adminUid: 'admin-1', key: 'k1' }, 'x')),
      ).not.toContain('example.com');
      const other = await s.post(s.body({ issuedAt: '2025-11-01T10:00:00Z' }), {
        ...admin,
        'idempotency-key': 'k1',
      });
      expect(other.statusCode).toBe(422);
      expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('audits certificate.issued without name or e-mail', async () => {
      const lines: string[] = [];
      const logs = new Writable({
        write(chunk: Buffer, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      });
      const s = await setup({ logs });
      await fakes_putTemplates(s, [s.tpl(1)]);
      const res = await s.post(s.body({ email: 'secret@example.com' }));
      const text = lines.join('');
      const auditLine = lines.flatMap((l) => l.split('\n')).find((l) => l.includes('"audit":true'));
      expect(auditLine).toBeDefined();
      expect(JSON.parse(auditLine!)).toMatchObject({
        action: 'certificate.issued',
        entityId: res.json().id,
        organizationId: s.org.id,
        eventId: s.event.id,
        adminUid: 'admin-1',
      });
      expect(text).not.toContain('secret@example.com');
      expect(text).not.toContain('Aysel');
    });

    it('auth matrix: 401 without a token, 403 for a non-admin', async () => {
      const s = await setup();
      const none = await s.post(s.body(), {});
      const user = await s.post(s.body(), { authorization: `Bearer ${fakeToken('u1')}` });
      expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
      let seen = false;
      await forEachAdminRoute(app!, async (route) => {
        if (route.method !== 'POST' || route.url !== '/api/v1/admin/certificates') return;
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
    });

    it('does not register the route without a fitChecker', async () => {
      const s = await setup({ withFitChecker: false });
      const res = await s.post(s.body());
      expect(res.statusCode).toBeGreaterThanOrEqual(404);
      expect(res.statusCode).toBeLessThanOrEqual(405);
    });
  });
}

async function fakes_putTemplates(s: { fakes: Fakes }, templates: Template[]): Promise<void> {
  for (const t of templates) await s.fakes.templates.create(t);
}
