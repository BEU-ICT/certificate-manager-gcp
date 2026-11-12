/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { buildServices } from '../../src/services.js';
import { PublicCertificateDto } from '../../src/http/dto/public/certificate.js';
import { ErrorBodyDto } from '../../src/http/dto/public/error.js';
import { listAdminRoutes } from '../../src/http/auth/admin-guard.js';
import { forEachAdminRoute, type AdminRouteCase } from '../../src/testing/admin-routes.js';
import {
  sampleCertificate,
  sampleEvent,
  sampleOrganization,
  sampleTemplate,
} from '../../src/testing/contracts/index.js';
import { createFakes, fakeToken, type Fakes } from '../../src/testing/fakes/index.js';
import { TEST_TASK_CREDENTIAL } from '../../src/testing/fakes/fake-verifiers.js';
import { SEND_EMAIL_HANDLER } from '../../src/shared/email-task.js';
import {
  ADMIN_TOKEN,
  EXPIRED_TOKEN,
  ROUTES_WITH_HAPPY_PATH_TEST,
  checkAdminRoute,
  checkHappyPathRegistry,
  findPublicLeaks,
  listAllRoutes,
  routeKey,
  routesUnder,
} from '../helpers/authz-matrix.js';

/**
 * Authorisation matrix (BEU-ICT/certificate-manager#398). Everything is derived from the route
 * table of the built app, so a route added later is covered without editing this file.
 * `npm run test:authz` runs it (with fakes only); the deployed-environment variant is
 * `authz-deployed.test.ts`.
 */

const URLS = { publicBaseUrl: 'https://app.test', pdfPublicBaseUrl: 'https://pdf.test' };
const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup(fakes: Fakes = createFakes()) {
  fakes.tokenVerifier.allow(EXPIRED_TOKEN, {
    uid: 'gone',
    email: 'gone@example.test',
    role: 'admin',
  });
  fakes.tokenVerifier.revoke(EXPIRED_TOKEN);
  // Issuance routes exist only with a FitChecker; a stub registers them.
  const fitChecker = { checkFit: () => Promise.resolve({ fits: true, issues: [] }) };
  const services = buildServices(fakes, undefined, { fitChecker });
  const app = buildApp({
    ports: fakes,
    services,
    publicUrls: URLS,
    // The matrix sends many requests from one client; the limiters are tested elsewhere.
    adminRateLimitPerMin: 100_000,
    adminPreAuthRateLimitPerMin: 100_000,
  });
  apps.push(app);
  return { app, fakes, services };
}

describe('admin authorization matrix', () => {
  it('every admin route: 401 without a valid token, 403 without the claim, reachable for admins', async () => {
    const { app } = setup();
    const violations: string[] = [];
    let routes = 0;
    await forEachAdminRoute(app, async (route) => {
      routes += 1;
      violations.push(...(await checkAdminRoute((o) => app.inject(o), route)));
    });
    expect(routes).toBeGreaterThanOrEqual(20);
    expect(violations).toEqual([]);
  });

  it('every admin route is registered through the guard', async () => {
    const { app } = setup();
    await app.ready();
    expect(listAdminRoutes(app).filter((r) => !r.guarded)).toEqual([]);
  });

  it('every admin route has a registered happy-path test that exists and is tagged for it', async () => {
    const { app } = setup();
    await app.ready();
    const routes = listAdminRoutes(app).filter(
      (r) => r.method !== 'HEAD' && r.method !== 'OPTIONS',
    );
    expect(checkHappyPathRegistry(routes, ROUTES_WITH_HAPPY_PATH_TEST)).toEqual([]);
  });
});

describe('matrix self-tests (a new unprotected or untested admin route fails the suite)', () => {
  it('app startup aborts when an admin route bypasses adminRoutes()', async () => {
    const { app } = setup();
    app.get('/api/v1/admin/leaky', () => ({ secret: true }));
    await expect(app.ready()).rejects.toThrow(/Admin routes without authentication.*leaky/u);
  });

  it('checkAdminRoute reports a route that answers without authentication', async () => {
    // A bare instance models an admin route whose guard went missing (what the startup check
    // normally prevents): the helper must name every broken expectation.
    const bare = Fastify();
    apps.push(bare);
    bare.get('/api/v1/admin/open', () => ({ ok: true }));
    await bare.ready();
    const route: AdminRouteCase = {
      method: 'GET',
      url: '/api/v1/admin/open',
      guarded: false,
      concreteUrl: '/api/v1/admin/open',
    };
    const violations = await checkAdminRoute((o) => bare.inject(o), route);
    expect(violations).toHaveLength(7);
    expect(violations.join('\n')).toContain('no token -> 200, want 401');
    expect(violations.join('\n')).toContain('user without admin claim -> 200, want 403');
  });

  it('checkHappyPathRegistry reports routes without an entry, stale files and removed routes', () => {
    const routes = [
      { method: 'GET', url: '/api/v1/admin/new-thing' },
      { method: 'GET', url: '/api/v1/admin/me' },
      { method: 'GET', url: '/api/v1/admin/stats' },
    ];
    const problems = checkHappyPathRegistry(
      routes,
      {
        'GET /api/v1/admin/me': 'test/unit/missing.test.ts',
        'GET /api/v1/admin/stats': 'x.ts',
        'GET /api/v1/admin/gone': 'x.ts',
      },
      (file) => (file === 'x.ts' ? '// happy-path: GET /api/v1/admin/other\n' : undefined),
    );
    expect(problems).toEqual([
      'GET /api/v1/admin/new-thing: no happy-path test registered in ROUTES_WITH_HAPPY_PATH_TEST',
      'GET /api/v1/admin/me: test/unit/missing.test.ts does not exist',
      'GET /api/v1/admin/stats: x.ts has no "// happy-path: GET /api/v1/admin/stats" tag',
      'GET /api/v1/admin/gone: registered but the route does not exist',
    ]);
  });

  it('listAllRoutes finds the public and internal routes of the built app', async () => {
    const { app } = setup();
    await app.ready();
    const keys = listAllRoutes(app).map(routeKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        'GET /api/v1/public/certificates/:id',
        'GET /api/v1/public/certificates/:id/pdf',
        `POST ${SEND_EMAIL_HANDLER}`,
        'GET /api/v1/admin/me',
        'POST /api/v1/admin/certificates/:id/revoke',
      ]),
    );
  });

  it('findPublicLeaks flags forbidden keys, email-shaped strings and pdfs/ names', () => {
    expect(
      findPublicLeaks({
        email: 'a',
        nested: [{ PdfPath: 'x' }],
        note: 'write to a@b.co',
        other: 'pdfs/abc.pdf',
        pdfUrl: 'https://pdf.test/pdfs/abc.pdf',
      }),
    ).toEqual([
      '$.email: forbidden key',
      '$.nested[0].PdfPath: forbidden key',
      '$.note: email-shaped string',
      '$.other: storage object name outside pdfUrl',
    ]);
    expect(findPublicLeaks({ pdfUrl: 'https://pdf.test/pdfs/abc.pdf', ownerName: 'A' })).toEqual(
      [],
    );
  });
});

describe('public routes expose only the whitelist', () => {
  const ACTIVE = 'AbCdEfGhIjKlMnOpQrStUv';
  const WITH_PDF = 'BbCdEfGhIjKlMnOpQrStUv';
  const REVOKED = 'CbCdEfGhIjKlMnOpQrStUv';
  const UNKNOWN = 'DbCdEfGhIjKlMnOpQrStUv';

  async function seeded() {
    const fakes = createFakes();
    const base = {
      email: 'private.person@example.test',
      emailStatus: 'sent' as const,
      createdBy: 'admin-secret-uid',
    };
    const certs = [
      sampleCertificate({ ...base, id: ACTIVE as never }),
      sampleCertificate({ ...base, id: WITH_PDF as never, pdfPath: 'tok-123.pdf' }),
      sampleCertificate({
        ...base,
        id: REVOKED as never,
        status: 'revoked',
        revokedAt: new Date(0),
        revokeReason: 'Issued to the wrong person',
        pdfPath: 'tok-456.pdf',
      }),
    ];
    for (const c of certs) await fakes.certificates.create(c);
    return setup(fakes);
  }

  /** Probes per public route; a new public route without a probe fails the coverage test below. */
  const PROBES: Record<string, (app: FastifyInstance) => Promise<void>> = {
    'GET /api/v1/public/certificates/:id': async (app) => {
      for (const id of [ACTIVE, WITH_PDF, REVOKED]) {
        const res = await app.inject({ method: 'GET', url: `/api/v1/public/certificates/${id}` });
        expect(res.statusCode).toBe(200);
        const body: unknown = res.json();
        // Strict: any property outside the documented response schema fails the parse.
        expect(PublicCertificateDto.strict().safeParse(body).success).toBe(true);
        expect(findPublicLeaks(body)).toEqual([]);
        expect(res.payload).not.toContain('private.person');
        expect(res.payload).not.toContain('admin-secret-uid');
        expect(res.payload).not.toContain('wrong person');
      }
      const direct = (
        await app.inject({ method: 'GET', url: `/api/v1/public/certificates/${WITH_PDF}` })
      ).json();
      expect(direct.pdfUrl).toBe('https://pdf.test/pdfs/tok-123.pdf');
      const revoked = (
        await app.inject({ method: 'GET', url: `/api/v1/public/certificates/${REVOKED}` })
      ).json();
      expect(revoked).toMatchObject({ status: 'revoked', pdfUrl: null });
      const unknown = await app.inject({
        method: 'GET',
        url: `/api/v1/public/certificates/${UNKNOWN}`,
      });
      expect(unknown.statusCode).toBe(404);
      expect(ErrorBodyDto.strict().safeParse(unknown.json()).success).toBe(true);
      expect(findPublicLeaks(unknown.json())).toEqual([]);
    },
    'GET /api/v1/public/certificates/:id/pdf': async (app) => {
      const revoked = await app.inject({
        method: 'GET',
        url: `/api/v1/public/certificates/${REVOKED}/pdf`,
      });
      expect(revoked.statusCode).toBe(410);
      expect(ErrorBodyDto.strict().safeParse(revoked.json()).success).toBe(true);
      expect(findPublicLeaks(revoked.json())).toEqual([]);
      expect(revoked.payload).not.toContain('tok-456');
      const unknown = await app.inject({
        method: 'GET',
        url: `/api/v1/public/certificates/${UNKNOWN}/pdf`,
      });
      expect(unknown.statusCode).toBe(404);
      expect(findPublicLeaks(unknown.json())).toEqual([]);
      // An existing PDF redirects; the object name is only in Location, never in the body.
      const ok = await app.inject({
        method: 'GET',
        url: `/api/v1/public/certificates/${WITH_PDF}/pdf`,
      });
      expect(ok.statusCode).toBe(302);
      expect(ok.headers['location']).toBe('https://pdf.test/pdfs/tok-123.pdf');
      expect(ok.payload).not.toMatch(/pdfs\/|@/u);
    },
  };

  it('every public route has a probe, and every probe passes', async () => {
    const { app } = await seeded();
    await app.ready();
    const publicRoutes = routesUnder(listAllRoutes(app), '/api/v1/public').map(routeKey);
    expect(publicRoutes.length).toBeGreaterThanOrEqual(2);
    expect(publicRoutes.filter((r) => !(r in PROBES))).toEqual([]);
    expect(Object.keys(PROBES).filter((k) => !publicRoutes.includes(k))).toEqual([]);
    for (const key of publicRoutes) await PROBES[key]!(app);
  });

  it('public routes ignore credentials: an admin token changes nothing in the body', async () => {
    const { app } = await seeded();
    const url = `/api/v1/public/certificates/${ACTIVE}`;
    const anon = await app.inject({ method: 'GET', url });
    const withToken = await app.inject({ method: 'GET', url, headers: admin });
    expect(withToken.json()).toEqual(anon.json());
  });
});

describe('internal routes', () => {
  // TODO(BEU-ICT/certificate-manager#368): wrong-audience and wrong-service-account rejection is
  // NOT covered here; it needs the real Cloud Tasks OIDC verifier of #368. The verifier below is a
  // fake that accepts exactly one header value, so these cases only prove that the route's
  // onRequest hook rejects anything else with 401 before the body is parsed.
  it('send-email rejects missing and non-matching credentials (fake verifier) with an empty 401 before reading the body', async () => {
    const { app, fakes } = setup();
    await fakes.certificates.create(sampleCertificate({ email: 'x@example.test' }));
    const attempts: Record<string, string>[] = [
      {},
      { authorization: '' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer some-other-token' },
      { authorization: `Basic ${TEST_TASK_CREDENTIAL}` },
      { authorization: TEST_TASK_CREDENTIAL.toUpperCase() },
      // An admin or user token is not a task credential.
      { authorization: `Bearer ${ADMIN_TOKEN}` },
      { authorization: `Bearer ${fakeToken('someone', 'admin')}` },
    ];
    for (const headers of attempts) {
      const res = await app.inject({
        method: 'POST',
        url: SEND_EMAIL_HANDLER,
        headers: { 'content-type': 'application/json', ...headers },
        payload: '{not json',
      });
      expect(res.statusCode, JSON.stringify(headers)).toBe(401);
      expect(res.payload).toBe('');
    }
    expect(fakes.emailSender.sent).toEqual([]);
  });

  it('internal routes are neither under /api/v1 nor in the OpenAPI-visible admin tree', async () => {
    const { app } = setup();
    await app.ready();
    const internal = routesUnder(listAllRoutes(app), '/internal').map(routeKey);
    expect(internal).toEqual(expect.arrayContaining([`POST ${SEND_EMAIL_HANDLER}`]));
    // Admin credentials do not open them either.
    const res = await app.inject({
      method: 'POST',
      url: SEND_EMAIL_HANDLER,
      headers: admin,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('mass assignment on admin writes', () => {
  const EXTRAS: Record<string, unknown>[] = [
    { status: 'revoked' },
    { createdBy: 'attacker' },
    { pdfPath: 'pdfs/evil.pdf' },
    { emailStatus: 'sent' },
    { id: 'chosen-by-client' },
    { createdAt: '2000-01-01T00:00:00.000Z' },
  ];

  const call = (app: FastifyInstance, method: 'POST' | 'PATCH', url: string, payload: object) =>
    app.inject({ method, url: `/api/v1/admin${url}`, headers: admin, payload });

  /** Asserts the 400/422 rejection names the unexpected property. */
  function expectRejected(
    res: Awaited<ReturnType<typeof call>>,
    extra: Record<string, unknown>,
  ): void {
    expect([400, 422], `${res.statusCode} ${res.payload}`).toContain(res.statusCode);
    expect(res.payload).toContain(Object.keys(extra)[0]!);
  }

  it('organizations: create and rename reject unknown fields and slug changes; nothing is stored', async () => {
    const { app } = setup();
    for (const extra of EXTRAS) {
      expectRejected(await call(app, 'POST', '/organizations', { name: 'Acme', ...extra }), extra);
    }
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations',
      headers: admin,
    });
    expect(list.json().items).toEqual([]);

    const created = await call(app, 'POST', '/organizations', { name: 'Acme' });
    expect(created.statusCode).toBe(201);
    const before = created.json();
    for (const extra of [...EXTRAS, { slug: 'taken-over' }]) {
      expectRejected(
        await call(app, 'PATCH', `/organizations/${before.id}`, { name: 'Renamed', ...extra }),
        extra,
      );
    }
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${before.id}`,
      headers: admin,
    });
    expect(after.json()).toEqual(before);
  });

  it('events: create and update reject unknown fields, slug and organization changes', async () => {
    const { app, fakes } = setup();
    const org = sampleOrganization();
    await fakes.organizations.create(org);
    for (const extra of EXTRAS) {
      expectRejected(
        await call(app, 'POST', '/events', { organizationId: org.id, name: 'DevFest', ...extra }),
        extra,
      );
    }
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/admin/events', headers: admin })).json()
        .items,
    ).toEqual([]);

    const created = await call(app, 'POST', '/events', { organizationId: org.id, name: 'DevFest' });
    expect(created.statusCode).toBe(201);
    const before = created.json();
    for (const extra of [...EXTRAS, { slug: 'other' }, { organizationId: 'someone-else' }]) {
      expectRejected(
        await call(app, 'PATCH', `/events/${before.id}`, { name: 'Renamed', ...extra }),
        extra,
      );
    }
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/events/${before.id}`,
      headers: admin,
    });
    expect(after.json()).toEqual(before);
  });

  it('certificates: issuance, bulk, revocation, resend and template copy reject unknown fields', async () => {
    const { app, fakes } = setup();
    const org = sampleOrganization();
    const event = sampleEvent({ organizationId: org.id });
    await fakes.organizations.create(org);
    await fakes.events.create(event);
    await fakes.templates.create(
      sampleTemplate({ organizationId: org.id, eventId: event.id, version: 1 }),
    );
    const existing = sampleCertificate({ organizationId: org.id, eventId: event.id });
    await fakes.certificates.create(existing);
    const countBefore = await fakes.certificates.count({});

    const issue = {
      organizationId: org.id,
      eventId: event.id,
      type: 'attendance',
      ownerName: 'Aysel Mammadova',
      subject: 'Subject',
    };
    const bulk = { ...issue, items: [{ ownerName: 'Aysel Mammadova' }] };
    const cases: { method: 'POST'; url: string; body: object }[] = [
      { method: 'POST', url: '/certificates', body: issue },
      { method: 'POST', url: '/certificates/bulk', body: bulk },
      { method: 'POST', url: `/certificates/${existing.id}/revoke`, body: { reason: 'Mistake' } },
      { method: 'POST', url: `/certificates/${existing.id}/resend-email`, body: {} },
      {
        method: 'POST',
        url: '/templates/attendance-v1/copy',
        body: { organizationId: org.id, eventId: event.id },
      },
    ];
    for (const c of cases) {
      for (const extra of [...EXTRAS, { slug: 'x' }, { revokeReason: 'x' }]) {
        expectRejected(await call(app, c.method, c.url, { ...c.body, ...extra }), extra);
      }
    }
    expect(await fakes.certificates.count({})).toBe(countBefore);
    const stored = await fakes.certificates.getById(existing.id);
    expect(stored).toEqual(existing);

    // Control: the same issuance body without extras is accepted, so the rejections above are
    // caused by the extra property and not by an otherwise invalid body.
    const ok = await call(app, 'POST', '/certificates', issue);
    expect(ok.statusCode, ok.payload).toBe(201);
  });
});

// The issue also lists `slug` on template PATCH, but there is no template PATCH route (templates
// are immutable versions). This test pins the template route list: a future PATCH route fails it
// (and the happy-path registry) until it is covered by the mass-assignment tests above.
describe('route table has no template mutation other than create/copy/preview', () => {
  it('lists the template routes', async () => {
    const { app } = setup();
    await app.ready();
    const templates = routesUnder(listAllRoutes(app), '/api/v1/admin/templates').map(routeKey);
    expect(templates.sort()).toEqual([
      'GET /api/v1/admin/templates',
      'GET /api/v1/admin/templates/:reference',
      'POST /api/v1/admin/templates',
      'POST /api/v1/admin/templates/:reference/copy',
      'POST /api/v1/admin/templates/:reference/preview',
    ]);
  });
});
