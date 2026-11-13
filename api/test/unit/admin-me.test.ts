// Routes with a happy-path test in this file (checked by test/unit/authz-matrix.test.ts):
// happy-path: GET /api/v1/admin/me
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createFeatureFlags, parseFlags } from '../../src/flags.js';
import { createFakes, fakeToken } from '../../src/testing/fakes/index.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});

const get = (headers: Record<string, string> = {}) =>
  app!.inject({ method: 'GET', url: '/api/v1/admin/me', headers });

describe('GET /api/v1/admin/me', () => {
  it('returns the administrator and the UI feature flags, uncached', async () => {
    const { flags } = parseFlags({ FEATURE_BULK_ISSUANCE: 'false' }, true);
    app = buildApp({ ports: createFakes(), flags: createFeatureFlags(flags) });
    const res = await get({ authorization: `Bearer ${fakeToken('a1', 'admin')}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      uid: 'a1',
      email: 'a1@example.test',
      role: 'admin',
      features: { bulkIssuance: false, publicPdfGeneration: true },
    });
  });

  it('rejects non-admin (403) and anonymous (401) callers', async () => {
    app = buildApp({ ports: createFakes() });
    expect((await get({ authorization: `Bearer ${fakeToken('u1')}` })).statusCode).toBe(403);
    expect((await get()).statusCode).toBe(401);
  });
});
