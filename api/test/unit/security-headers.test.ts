import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createFakes, fakeToken } from '../../src/testing/fakes/index.js';

const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function build(): FastifyInstance {
  app = buildApp({ ports: createFakes(), adminRateLimitPerMin: 100_000 });
  app.post('/echo', (request) => request.body);
  app.get('/redirect', (_request, reply) => reply.redirect('https://pdf.example.test/x.pdf', 302));
  return app;
}

const EXPECTED = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

describe('security headers', () => {
  it.each([
    ['public lookup (404)', 'GET', '/api/v1/public/certificates/unknown', {}, 404],
    ['public lookup, absurd id', 'GET', `/api/v1/public/certificates/${'a'.repeat(200)}`, {}, 404],
    ['admin success', 'GET', '/api/v1/admin/organizations', admin, 200],
    ['admin unauthenticated', 'GET', '/api/v1/admin/organizations', {}, 401],
    ['health', 'GET', '/internal/healthz', {}, 200],
    ['unknown route', 'GET', '/nope', {}, 404],
    ['redirect', 'GET', '/redirect', {}, 302],
  ])(
    '%s carries the full set and never leaks server details',
    async (_n, method, url, headers, status) => {
      const res = await build().inject({ method: method as 'GET', url, headers });
      expect(res.statusCode).toBe(status);
      expect(res.headers).toMatchObject(EXPECTED);
      expect(res.headers['permissions-policy']).toContain('camera=()');
      expect(res.headers).not.toHaveProperty('x-powered-by');
      expect(res.headers).not.toHaveProperty('server');
    },
  );

  it('defaults to no-store but keeps a route-chosen policy', async () => {
    const a = build();
    expect(
      (await a.inject({ method: 'GET', url: '/internal/healthz' })).headers['cache-control'],
    ).toBe('no-store');
    expect((await a.inject({ method: 'GET', url: '/nope' })).headers['cache-control']).toBe(
      'no-store',
    );
    expect(
      (await a.inject({ method: 'GET', url: '/api/v1/admin/organizations', headers: admin }))
        .headers['cache-control'],
    ).toBe('no-store');
    expect(
      (await a.inject({ method: 'GET', url: '/api/v1/public/certificates/nope' })).headers[
        'cache-control'
      ],
    ).toBe('no-cache');
  });
});

describe('CORS', () => {
  it('has no CORS headers and answers preflight with 404, also on existing paths', async () => {
    const a = build();
    for (const url of ['/api/v1/admin/organizations', '/internal/healthz', '/nope']) {
      const res = await a.inject({
        method: 'OPTIONS',
        url,
        headers: {
          origin: 'https://evil.test',
          'access-control-request-method': 'GET',
        },
      });
      expect(res.statusCode).toBe(404);
      expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
    }
    const get = await a.inject({
      method: 'GET',
      url: '/internal/healthz',
      headers: { origin: 'https://evil.test' },
    });
    expect(Object.keys(get.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});

describe('request limits', () => {
  it('rejects bodies over 1 MB with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'a'.repeat(1024 * 1024 + 1) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers an unsupported content type with 415', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=1',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a __proto__ body', async () => {
    const res = await build().inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"__proto__": {"polluted": true}}',
    });
    expect(res.statusCode).toBe(400);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects URLs over 2 KB with 414', async () => {
    const res = await build().inject({
      method: 'GET',
      url: `/internal/healthz?q=${'a'.repeat(2100)}`,
    });
    expect(res.statusCode).toBe(414);
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
