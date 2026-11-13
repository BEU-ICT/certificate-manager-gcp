// Routes with a happy-path test in this file (checked by test/unit/authz-matrix.test.ts):
// happy-path: GET /api/v1/admin/certificates
// happy-path: GET /api/v1/admin/certificates/count
// happy-path: GET /api/v1/admin/certificates/:id
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import type { Certificate } from '../../src/shared/domain.js';
import { asEventId, asOrganizationId } from '../../src/shared/ids.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { fakeToken, type Fakes } from '../../src/testing/fakes/index.js';

const ORG_A = asOrganizationId('org-a');
const ORG_B = asOrganizationId('org-b');
const EVENT_A = asEventId('event-a');
const EVENT_B = asEventId('event-b');
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);

/**
 * Behaviour of the read side of `/api/v1/admin/certificates` (list, count, detail), run
 * against in-memory fakes (unit) and the Firestore adapter on the emulator (integration).
 */
export function describeCertificatesApi(
  name: string,
  makePorts: () => Promise<Fakes> | Fakes,
): void {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });
  const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };

  async function setup(seed: Certificate[] = []): Promise<Fakes> {
    const fakes = await makePorts();
    if (seed.length > 0) {
      for (let i = 0; i < seed.length; i += 400)
        await fakes.certificates.createMany(seed.slice(i, i + 400));
    }
    app = buildApp({
      ports: fakes,
      services: buildServices(fakes),
      adminRateLimitPerMin: 100_000,
      publicUrls: {
        publicBaseUrl: 'https://app.example.test/',
        pdfPublicBaseUrl: 'https://pdf.example.test',
      },
    });
    return fakes;
  }
  const get = (url: string, headers: Record<string, string> = admin) =>
    app!.inject({ method: 'GET', url: `/api/v1/admin${url}`, headers });
  const ids = (res: { json: () => { items: { id: string }[] } }) =>
    res.json().items.map((i) => i.id);

  const cert = (n: number, over: Partial<Certificate> = {}): Certificate =>
    sampleCertificate({
      issuedAt: new Date(T0 + n * 60_000),
      organizationId: ORG_A,
      eventId: EVENT_A,
      ...over,
    });

  /** A varied data set: every filter value occurs, some documents match several filters. */
  const mixed = (): Certificate[] => [
    cert(1, { type: 'attendance', status: 'active', emailStatus: 'sent', email: 'a@example.com' }),
    cert(2, {
      type: 'thanks',
      status: 'revoked',
      revokedAt: new Date(T0),
      revokeReason: 'r',
      emailStatus: 'failed',
      email: 'b@example.com',
    }),
    cert(3, {
      organizationId: ORG_B,
      eventId: EVENT_B,
      type: 'thanks',
      emailStatus: 'pending',
      email: 'c@example.com',
    }),
    cert(4, {
      organizationId: ORG_B,
      eventId: EVENT_B,
      type: 'attendance',
      emailStatus: 'skipped',
    }),
    cert(5, { eventId: EVENT_B, type: 'attendance', emailStatus: 'skipped' }),
  ];

  describe(`certificates API: ${name}`, () => {
    it('lists newest first with the summary shape and without e-mail or pdfPath', async () => {
      const seed = mixed();
      await setup(seed);
      const res = await get('/certificates');
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json();
      expect(body.nextCursor).toBeNull();
      expect(body.items.map((i: { id: string }) => i.id)).toEqual(
        [...seed].reverse().map((c) => c.id),
      );
      expect(body.items[4]).toEqual({
        id: seed[0]!.id,
        ownerName: seed[0]!.ownerName,
        organizationName: 'Org',
        eventName: 'Event',
        type: 'attendance',
        subject: 'Subject',
        issuedAt: seed[0]!.issuedAt.toISOString(),
        status: 'active',
        emailStatus: 'sent',
        hasEmail: true,
      });
      expect(body.items[0].hasEmail).toBe(false);
      expect(JSON.stringify(body)).not.toMatch(/@example\.com|"email"|pdfPath|certificates\//);
    });

    it.each([
      ['organizationId', 'organizationId=org-b', [3, 4]],
      ['eventId', 'eventId=event-b', [3, 4, 5]],
      ['type', 'type=thanks', [2, 3]],
      ['status', 'status=revoked', [2]],
      ['emailStatus', 'emailStatus=skipped', [4, 5]],
      ['emailStatus failed', 'emailStatus=failed', [2]],
    ])('filters by %s', async (_n, query, expected) => {
      const seed = mixed();
      await setup(seed);
      const res = await get(`/certificates?${query}`);
      expect(ids(res)).toEqual(expected.reverse().map((n) => seed[n - 1]!.id));
      const count = await get(`/certificates/count?${query}`);
      expect(count.json()).toEqual({ count: expected.length });
    });

    it('combines filters (AND)', async () => {
      const seed = mixed();
      await setup(seed);
      const q =
        'organizationId=org-a&eventId=event-b&type=attendance&status=active&emailStatus=skipped';
      expect(ids(await get(`/certificates?${q}`))).toEqual([seed[4]!.id]);
      expect((await get(`/certificates/count?${q}`)).json()).toEqual({ count: 1 });
      expect(
        ids(await get('/certificates?organizationId=org-b&type=thanks&emailStatus=failed')),
      ).toEqual([]);
    });

    it('date range: issuedFrom inclusive, issuedTo exclusive for date-times, whole day for dates', async () => {
      const seed = [
        cert(0, { issuedAt: new Date(Date.UTC(2026, 0, 9, 23, 59, 59, 999)) }),
        cert(0, { issuedAt: new Date(Date.UTC(2026, 0, 10, 0, 0, 0, 0)) }),
        cert(0, { issuedAt: new Date(Date.UTC(2026, 0, 10, 23, 59, 59, 999)) }),
        cert(0, { issuedAt: new Date(Date.UTC(2026, 0, 11, 0, 0, 0, 0)) }),
      ];
      await setup(seed);
      const day = await get('/certificates?issuedFrom=2026-01-10&issuedTo=2026-01-10');
      expect(ids(day)).toEqual([seed[2]!.id, seed[1]!.id]);
      const instants = await get(
        '/certificates?issuedFrom=2026-01-10T00:00:00.000Z&issuedTo=2026-01-11T00:00:00.000Z',
      );
      expect(ids(instants)).toEqual([seed[2]!.id, seed[1]!.id]);
      expect(ids(await get('/certificates?issuedFrom=2026-01-11T00:00:00Z'))).toEqual([
        seed[3]!.id,
      ]);
      expect(ids(await get('/certificates?issuedTo=2026-01-10T00:00:00Z'))).toEqual([seed[0]!.id]);
      expect(
        (await get('/certificates/count?issuedFrom=2026-01-10&issuedTo=2026-01-10')).json(),
      ).toEqual({ count: 2 });
    });

    it('paginates 120 records in pages of 50 without gaps or repeats; count equals the total', async () => {
      const seed = Array.from({ length: 120 }, (_v, i) => cert(i));
      await setup(seed);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await get(`/certificates?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
        const body = res.json();
        seen.push(...body.items.map((i: { id: string }) => i.id));
        cursor = body.nextCursor;
        pages += 1;
        expect(body.items.length).toBeLessThanOrEqual(50);
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual([...seed].reverse().map((c) => c.id));
      expect((await get('/certificates/count')).json()).toEqual({ count: 120 });
      expect((await get('/certificates')).json().items).toHaveLength(25);
    });

    it('runs all 63 filter combinations', async () => {
      await setup(mixed());
      const parts = [
        'organizationId=org-a',
        'eventId=event-a',
        'type=attendance',
        'status=active',
        'emailStatus=sent',
        'issuedFrom=2026-01-01&issuedTo=2026-12-31',
      ];
      for (let mask = 1; mask < 64; mask += 1) {
        const query = parts.filter((_p, i) => (mask & (1 << i)) !== 0).join('&');
        const [list, count] = [
          await get(`/certificates?${query}`),
          await get(`/certificates/count?${query}`),
        ];
        expect(list.statusCode, query).toBe(200);
        expect(count.json().count, query).toBe(list.json().items.length);
      }
    });

    it('returns the full detail with derived URLs and never pdfPath', async () => {
      const full = cert(1, {
        email: 'owner@example.com',
        emailStatus: 'sent',
        emailAttempts: 2,
        emailSentAt: new Date(T0 + 5),
        emailLastError: 'earlier',
        pdfPath: 'certificates/abc def.pdf',
        pdfGeneratedAt: new Date(T0 + 9),
        status: 'revoked',
        revokedAt: new Date(T0 + 10),
        revokeReason: 'mistake',
        skills: ['a'],
      });
      await setup([full]);
      const res = await get(`/certificates/${full.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: full.id,
        organizationId: 'org-a',
        eventId: 'event-a',
        organizationName: 'Org',
        eventName: 'Event',
        templateId: 'attendance-v1',
        type: 'attendance',
        ownerName: full.ownerName,
        email: 'owner@example.com',
        subject: 'Subject',
        skills: ['a'],
        status: 'revoked',
        issuedAt: full.issuedAt.toISOString(),
        revokedAt: new Date(T0 + 10).toISOString(),
        revokeReason: 'mistake',
        emailStatus: 'sent',
        emailAttempts: 2,
        emailSentAt: new Date(T0 + 5).toISOString(),
        emailLastError: 'earlier',
        publicUrl: `https://app.example.test/c/${full.id}`,
        pdfUrl: 'https://pdf.example.test/certificates/abc%20def.pdf',
        pdfGeneratedAt: new Date(T0 + 9).toISOString(),
        legacy: null,
        createdBy: 'admin-1',
        createdAt: full.createdAt.toISOString(),
        updatedAt: full.updatedAt.toISOString(),
      });
      expect(JSON.stringify(res.json())).not.toContain('pdfPath');
    });

    it('detail without optional data: nulls and no PDF URL', async () => {
      const minimal = cert(1);
      await setup([minimal]);
      expect((await get(`/certificates/${minimal.id}`)).json()).toMatchObject({
        email: null,
        revokedAt: null,
        revokeReason: null,
        emailSentAt: null,
        emailLastError: null,
        pdfUrl: null,
        pdfGeneratedAt: null,
      });
    });

    it('answers 404 for unknown and malformed ids, identically', async () => {
      await setup([cert(1)]);
      const unknown = await get(`/certificates/${'z'.repeat(22)}`);
      const malformed = await get('/certificates/not%20an%20id');
      const short = await get('/certificates/abc');
      const long = await get(`/certificates/${'a'.repeat(200)}`);
      expect([unknown.statusCode, malformed.statusCode, short.statusCode, long.statusCode]).toEqual(
        [404, 404, 404, 404],
      );
      expect(long.json().error.code).toBe('NOT_FOUND');
      expect(malformed.json().error.code).toBe('NOT_FOUND');
      expect(malformed.json().error.message).toBe(unknown.json().error.message);
    });

    it.each([
      ['limit 0', 'limit=0'],
      ['limit 51', 'limit=51'],
      ['limit text', 'limit=abc'],
      ['unknown type', 'type=bogus'],
      ['unknown status', 'status=bogus'],
      ['unknown emailStatus', 'emailStatus=bogus'],
      ['malformed organizationId', 'organizationId=a%20b'],
      ['malformed eventId', 'eventId=a%2Fb'],
      ['empty eventId', 'eventId='],
      ['bad date', 'issuedFrom=2026-13-45'],
      ['impossible date', 'issuedTo=2026-02-30'],
      ['non-date', 'issuedFrom=yesterday'],
      ['from after to', 'issuedFrom=2026-02-02&issuedTo=2026-02-01'],
      ['span over 5 years', 'issuedFrom=2020-01-01&issuedTo=2025-01-02'],
      ['unknown parameter', 'foo=1'],
      ['unusable cursor', 'cursor=not-a-cursor'],
    ])('rejects %s with 400 VALIDATION_FAILED', async (_n, query) => {
      await setup([cert(1)]);
      const res = await get(`/certificates?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    });

    it('count rejects invalid filters too; a span of exactly 5 years is accepted', async () => {
      await setup([cert(1)]);
      expect((await get('/certificates/count?type=bogus')).statusCode).toBe(400);
      expect((await get('/certificates/count?limit=5')).statusCode).toBe(400);
      expect(
        (await get('/certificates?issuedFrom=2020-01-01&issuedTo=2024-12-31')).statusCode,
      ).toBe(200);
    });

    it('answers 401 without a token and 403 for non-admins on every certificates route', async () => {
      await setup([cert(1)]);
      let seen = 0;
      await forEachAdminRoute(app!, async (route) => {
        if (!route.url.includes('/certificates')) return;
        seen += 1;
        const none = await app!.inject({ method: route.method as 'GET', url: route.concreteUrl });
        const user = await app!.inject({
          method: route.method as 'GET',
          url: route.concreteUrl,
          headers: { authorization: `Bearer ${fakeToken('u1')}` },
        });
        expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
      });
      expect(seen).toBeGreaterThanOrEqual(3);
    });
  });
}
