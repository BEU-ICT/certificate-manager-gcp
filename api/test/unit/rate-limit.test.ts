import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { adminRoutes } from '../../src/http/auth/admin-guard.js';
import { createRateLimitMetrics } from '../../src/http/rate-limit/index.js';
import { SEND_EMAIL_HANDLER } from '../../src/shared/email-task.js';
import { TEST_TASK_CREDENTIAL } from '../../src/testing/fakes/fake-verifiers.js';
import { FakeCertificateRepository } from '../../src/testing/fakes/fake-certificate-repository.js';
import { createFakes, fakeToken, type Fakes } from '../../src/testing/fakes/index.js';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

class CountingRepository extends FakeCertificateRepository {
  reads = 0;
  override getById(...args: Parameters<FakeCertificateRepository['getById']>) {
    this.reads += 1;
    return super.getById(...args);
  }
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function setup(over: { publicPerMin?: number; adminPerMin?: number; preAuth?: number } = {}) {
  const repo = new CountingRepository();
  const fakes: Fakes = { ...createFakes(), certificates: repo };
  const app = buildApp({
    ports: fakes,
    publicRateLimitPerMin: over.publicPerMin ?? 10,
    ...(over.adminPerMin !== undefined && { adminRateLimitPerMin: over.adminPerMin }),
    ...(over.preAuth !== undefined && { adminPreAuthRateLimitPerMin: over.preAuth }),
  });
  adminRoutes(app, (scope) => {
    scope.get('/probe', (request) => ({ uid: request.admin?.uid }));
  });
  apps.push(app);
  return { app, repo, fakes };
}

const publicGet = (app: FastifyInstance, url: string, ip = '203.0.113.7') =>
  app.inject({ method: 'GET', url, headers: { 'x-forwarded-for': ip } });
const details = (id = ID) => `/api/v1/public/certificates/${id}`;
const adminGet = (app: FastifyInstance, uid: string, ip: string) =>
  app.inject({
    method: 'GET',
    url: '/api/v1/admin/probe',
    headers: { authorization: `Bearer ${fakeToken(uid, 'admin')}`, 'x-forwarded-for': ip },
  });

describe('public rate limit', () => {
  it('answers the 11th request within a minute with 429 and all headers', async () => {
    const { app } = setup();
    for (let i = 1; i <= 10; i++) {
      const res = await publicGet(app, details());
      expect(res.statusCode).toBe(404);
      expect(res.headers['ratelimit-limit']).toBe('10');
      expect(res.headers['ratelimit-remaining']).toBe(String(10 - i));
      expect(res.headers['ratelimit-reset']).toBeDefined();
      expect(res.headers['retry-after']).toBeUndefined();
    }
    const res = await publicGet(app, details());
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    expect(res.headers['ratelimit-limit']).toBe('10');
    expect(res.headers['ratelimit-remaining']).toBe('0');
    expect(res.headers['ratelimit-reset']).toBe('60');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const body = res.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(typeof body.error.requestId).toBe('string');
    expect(res.body).not.toContain('203.0.113.7');
  });

  it('counts clients independently by the trusted proxy hop, ignoring forged left entries', async () => {
    const { app } = setup({ publicPerMin: 2 });
    for (let i = 0; i < 3; i++) await publicGet(app, details(), '203.0.113.1');
    expect((await publicGet(app, details(), '203.0.113.1')).statusCode).toBe(429);
    expect((await publicGet(app, details(), '203.0.113.2')).statusCode).toBe(404);
    // A client-supplied first entry does not buy a fresh budget: the right-most hop is the key.
    const forged = await publicGet(app, details(), '198.51.100.9, 203.0.113.1');
    expect(forged.statusCode).toBe(429);
  });

  it('shares one budget between details, pdf, malformed ids and unmatched public paths', async () => {
    const { app } = setup({ publicPerMin: 5 });
    const urls = [
      details(),
      `${details()}/pdf`,
      details('x'),
      details('not%20an%20id'),
      `${details()}/extra/segments`,
    ];
    for (const url of urls) expect((await publicGet(app, url)).statusCode).not.toBe(429);
    for (const url of [details(), `${details()}/pdf`, '/api/v1/public/nothing', details('x')]) {
      expect((await publicGet(app, url)).statusCode).toBe(429);
    }
  });

  it('enforces the limit before any repository read', async () => {
    const { app, repo } = setup({ publicPerMin: 2 });
    for (let i = 0; i < 2; i++) await publicGet(app, details());
    const readsBefore = repo.reads;
    expect(readsBefore).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      expect((await publicGet(app, details())).statusCode).toBe(429);
      expect((await publicGet(app, `${details()}/pdf`)).statusCode).toBe(429);
    }
    expect(repo.reads).toBe(readsBefore);
  });

  it('restores access after the window rolled over', async () => {
    const { app, fakes } = setup({ publicPerMin: 2 });
    for (let i = 0; i < 3; i++) await publicGet(app, details());
    expect((await publicGet(app, details())).statusCode).toBe(429);
    (fakes.clock as unknown as { advance: (ms: number) => void }).advance(121_000);
    expect((await publicGet(app, details())).statusCode).toBe(404);
  });

  it('does not limit the public routes unless a budget is configured', async () => {
    const app = buildApp({ ports: createFakes() });
    apps.push(app);
    for (let i = 0; i < 15; i++) {
      expect((await publicGet(app, details())).statusCode).toBe(404);
    }
  });
});

describe('admin rate limit', () => {
  it('counts per uid, not per IP', async () => {
    const { app } = setup({ adminPerMin: 2, preAuth: 1000 });
    expect((await adminGet(app, 'a', '203.0.113.1')).statusCode).toBe(200);
    expect((await adminGet(app, 'a', '203.0.113.1')).statusCode).toBe(200);
    const limited = await adminGet(app, 'a', '203.0.113.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('RATE_LIMITED');
    // second admin behind the same IP has their own budget
    expect((await adminGet(app, 'b', '203.0.113.1')).statusCode).toBe(200);
    // same admin from another IP shares the uid budget
    expect((await adminGet(app, 'a', '203.0.113.2')).statusCode).toBe(429);
  });

  it('carries RateLimit headers on success', async () => {
    const { app } = setup({ adminPerMin: 5, preAuth: 1000 });
    const res = await adminGet(app, 'a', '203.0.113.1');
    expect(res.headers['ratelimit-limit']).toBe('5');
    expect(res.headers['ratelimit-remaining']).toBe('4');
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('has a pre-auth budget per IP, separate from the per-uid budget', async () => {
    const { app } = setup({ adminPerMin: 100, preAuth: 3 });
    const bad = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/admin/probe',
        headers: { authorization: 'Bearer nope', 'x-forwarded-for': '203.0.113.5' },
      });
    for (let i = 0; i < 3; i++) expect((await bad()).statusCode).toBe(401);
    expect((await bad()).statusCode).toBe(429);
    // The per-uid budget of a valid admin from another IP is untouched.
    expect((await adminGet(app, 'a', '203.0.113.6')).statusCode).toBe(200);
  });
});

const advance = (fakes: Fakes, ms: number) =>
  (fakes.clock as unknown as { advance: (ms: number) => void }).advance(ms);

describe('Retry-After exactness', () => {
  it('admits a public client again after exactly Retry-After seconds', async () => {
    const { app, fakes } = setup({ publicPerMin: 2 });
    for (let i = 0; i < 2; i++) await publicGet(app, details());
    const limited = await publicGet(app, details());
    expect(limited.statusCode).toBe(429);
    const wait = Number(limited.headers['retry-after']);
    expect(limited.headers['ratelimit-reset']).toBe(String(wait));
    advance(fakes, (wait - 1) * 1000);
    expect((await publicGet(app, details())).statusCode).toBe(429);
    advance(fakes, 1000);
    expect((await publicGet(app, details())).statusCode).toBe(404);
  });

  it('admits an admin again after exactly Retry-After seconds', async () => {
    const { app, fakes } = setup({ adminPerMin: 2, preAuth: 1000 });
    for (let i = 0; i < 2; i++) await adminGet(app, 'a', '203.0.113.1');
    const limited = await adminGet(app, 'a', '203.0.113.1');
    expect(limited.statusCode).toBe(429);
    const wait = Number(limited.headers['retry-after']);
    expect(limited.headers['ratelimit-reset']).toBe(String(wait));
    advance(fakes, wait * 1000);
    expect((await adminGet(app, 'a', '203.0.113.1')).statusCode).toBe(200);
  });
});

describe('/internal rate limit', () => {
  it('allows 120 requests per minute and IP, then answers 429 with Retry-After', async () => {
    const { app } = setup();
    const post = () =>
      app.inject({
        method: 'POST',
        url: SEND_EMAIL_HANDLER,
        headers: {
          'content-type': 'application/json',
          authorization: TEST_TASK_CREDENTIAL,
          'x-forwarded-for': '203.0.113.50',
        },
        payload: '{}',
      });
    for (let i = 0; i < 120; i++) expect((await post()).statusCode).toBe(400);
    const limited = await post();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['ratelimit-limit']).toBe('120');
  });
});

describe('rate limit metrics', () => {
  it('logs aggregates per scope, warns above 50% and stays quiet without traffic', () => {
    const lines: { level: string; obj: Record<string, unknown> }[] = [];
    const metrics = createRateLimitMetrics(
      {
        info: (obj) => lines.push({ level: 'info', obj: obj as Record<string, unknown> }),
        warn: (obj) => lines.push({ level: 'warn', obj: obj as Record<string, unknown> }),
      },
      3_600_000,
    );
    try {
      metrics.flush();
      expect(lines).toHaveLength(0);
      for (let i = 0; i < 10; i++) metrics.record('public', i >= 8);
      for (let i = 0; i < 4; i++) metrics.record('admin', i >= 1);
      metrics.flush();
      expect(lines).toEqual([
        { level: 'info', obj: { scope: 'public', requests: 10, limited: 2 } },
        { level: 'warn', obj: { scope: 'admin', requests: 4, limited: 3 } },
      ]);
      metrics.flush();
      expect(lines).toHaveLength(2);
    } finally {
      metrics.close();
    }
  });
});
