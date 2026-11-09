import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { adminRoutes, installAdminGuard } from '../../src/http/auth/admin-guard.js';
import { installErrorHandling } from '../../src/http/error-handler.js';
import { withIdempotency } from '../../src/http/idempotency.js';
import { installRequestContext } from '../../src/http/request-context.js';
import { IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS, IDEMPOTENCY_TTL_MS } from '../../src/ports/index.js';
import { ValidationError } from '../../src/shared/errors.js';
import { canonicalJson, idempotencyDocumentId, requestHash } from '../../src/shared/idempotency.js';
import { createFakes, fakeToken, type Fakes } from '../../src/testing/fakes/index.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});

interface ErrorBody {
  error: { code: string };
}

interface Harness {
  fakes: Fakes;
  /** Number of times the (fake) issuance ran. */
  created: string[];
  /** When set, the handler waits for this promise before answering. */
  gate: { wait?: Promise<void> };
  post: (
    body: unknown,
    options?: { key?: string; uid?: string; url?: string },
  ) => Promise<LightMyRequestResponse>;
}

function setup(): Harness {
  const fakes = createFakes();
  const created: string[] = [];
  const gate: Harness['gate'] = {};
  app = Fastify();
  installRequestContext(app, {});
  installErrorHandling(app);
  installAdminGuard(app, { tokenVerifier: fakes.tokenVerifier });
  adminRoutes(app, (scope) => {
    scope.post(
      '/things',
      withIdempotency(fakes.idempotency, async (request) => {
        await gate.wait;
        const body = request.body as { name?: string; fail?: string };
        if (body.fail === 'client') throw new ValidationError('bad');
        if (body.fail === 'server') throw new Error('boom');
        const id = `id-${created.length + 1}`;
        created.push(id);
        return { status: 201, body: { id } };
      }),
    );
    scope.post(
      '/things/:id',
      withIdempotency(fakes.idempotency, () => Promise.resolve({ status: 201, body: { id: 'p' } })),
    );
    scope.post(
      '/status/:code',
      withIdempotency(fakes.idempotency, (request) =>
        Promise.resolve({
          status: Number((request.params as { code: string }).code),
          body: { id: 's', odd: undefined },
        }),
      ),
    );
    scope.post(
      '/others',
      withIdempotency(fakes.idempotency, () => Promise.resolve({ status: 201, body: { id: 'o' } })),
    );
  });
  const post: Harness['post'] = (body, options = {}) =>
    app!.inject({
      method: 'POST',
      url: options.url ?? '/api/v1/admin/things',
      headers: {
        authorization: `Bearer ${fakeToken(options.uid ?? 'a1', 'admin')}`,
        ...(options.key !== undefined && { 'idempotency-key': options.key }),
      },
      payload: body as object,
    });
  return { fakes, created, gate, post };
}

describe('withIdempotency', () => {
  it('behaves as before without the header', async () => {
    const h = setup();
    const a = await h.post({ name: 'x' });
    const b = await h.post({ name: 'x' });
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(h.created).toHaveLength(2);
    expect(a.headers['idempotent-replayed']).toBeUndefined();
    expect(h.fakes.idempotency.size).toBe(0);
  });

  it('replays the stored response without running the handler again', async () => {
    const h = setup();
    const first = await h.post({ name: 'x' }, { key: 'k1' });
    const second = await h.post({ name: 'x' }, { key: 'k1' });
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(h.created).toHaveLength(1);
  });

  it('treats a body with the same content in another key order as the same request', async () => {
    const h = setup();
    await h.post({ a: 1, b: { c: 2, d: 3 } }, { key: 'k1' });
    const again = await h.post({ b: { d: 3, c: 2 }, a: 1 }, { key: 'k1' });
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(h.created).toHaveLength(1);
  });

  it('answers 409 REQUEST_IN_PROGRESS to a concurrent duplicate, then replays after completion', async () => {
    const h = setup();
    let release!: () => void;
    h.gate.wait = new Promise<void>((resolve) => (release = resolve));
    const first = h.post({ name: 'x' }, { key: 'k1' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const concurrent = await h.post({ name: 'x' }, { key: 'k1' });
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json<ErrorBody>().error.code).toBe('REQUEST_IN_PROGRESS');
    expect(concurrent.headers['retry-after']).toBe('2');

    release();
    expect((await first).statusCode).toBe(201);
    const retry = await h.post({ name: 'x' }, { key: 'k1' });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(h.created).toHaveLength(1);
  });

  it('answers 422 IDEMPOTENCY_KEY_REUSED for the same key with another body or route', async () => {
    const h = setup();
    await h.post({ name: 'x' }, { key: 'k1' });
    const otherBody = await h.post({ name: 'y' }, { key: 'k1' });
    expect(otherBody.statusCode).toBe(422);
    expect(otherBody.json<ErrorBody>().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const otherRoute = await h.post({ name: 'x' }, { key: 'k1', url: '/api/v1/admin/others' });
    expect(otherRoute.statusCode).toBe(422);
    expect(h.created).toHaveLength(1);
  });

  it('scopes keys per administrator', async () => {
    const h = setup();
    await h.post({ name: 'x' }, { key: 'k1', uid: 'a1' });
    const other = await h.post({ name: 'x' }, { key: 'k1', uid: 'a2' });
    expect(other.statusCode).toBe(201);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(h.created).toHaveLength(2);
  });

  it('honours expiresAt even when the record was not deleted', async () => {
    const h = setup();
    await h.post({ name: 'x' }, { key: 'k1' });
    h.fakes.clock.advance(IDEMPOTENCY_TTL_MS);
    const again = await h.post({ name: 'x' }, { key: 'k1' });
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBeUndefined();
    expect(h.created).toHaveLength(2);
  });

  it('releases the key after a client error so the corrected request can reuse it', async () => {
    const h = setup();
    const bad = await h.post({ fail: 'client' }, { key: 'k1' });
    expect(bad.statusCode).toBe(400);
    expect(h.fakes.idempotency.size).toBe(0);
    const fixed = await h.post({ name: 'x' }, { key: 'k1' });
    expect(fixed.statusCode).toBe(201);
    expect(fixed.headers['idempotent-replayed']).toBeUndefined();
  });

  it('releases the key when the handler returns a 4xx status', async () => {
    const h = setup();
    const res = await h.post({}, { key: 'k1', url: '/api/v1/admin/status/404' });
    expect(res.statusCode).toBe(404);
    expect(h.fakes.idempotency.size).toBe(0);
  });

  it('keeps the key in_progress (stores nothing) when the handler returns a 5xx status', async () => {
    const h = setup();
    const res = await h.post({}, { key: 'k1', url: '/api/v1/admin/status/503' });
    expect(res.statusCode).toBe(503);
    expect(h.fakes.idempotency.size).toBe(1);
    const again = await h.post({}, { key: 'k1', url: '/api/v1/admin/status/503' });
    expect(again.statusCode).toBe(409);
  });

  it('treats the same route pattern with other path parameters as another request', async () => {
    const h = setup();
    expect((await h.post({}, { key: 'k1', url: '/api/v1/admin/things/1' })).statusCode).toBe(201);
    const other = await h.post({}, { key: 'k1', url: '/api/v1/admin/things/2' });
    expect(other.statusCode).toBe(422);
    expect(other.json<ErrorBody>().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const same = await h.post({}, { key: 'k1', url: '/api/v1/admin/things/1' });
    expect(same.headers['idempotent-replayed']).toBe('true');
  });

  it('stores a response body with undefined fields without failing', async () => {
    const h = setup();
    const url = '/api/v1/admin/status/201';
    expect((await h.post({}, { key: 'k1', url })).statusCode).toBe(201);
    const replay = await h.post({}, { key: 'k1', url });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual({ id: 's' });
  });

  it('keeps the key after a server error and lets a retry take over after 2 minutes', async () => {
    const h = setup();
    const failed = await h.post({ fail: 'server' }, { key: 'k1' });
    expect(failed.statusCode).toBe(500);
    expect((await h.post({ fail: 'server' }, { key: 'k1' })).statusCode).toBe(409);
    h.fakes.clock.advance(IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS);
    expect((await h.post({ fail: 'server' }, { key: 'k1' })).statusCode).toBe(500);
  });

  it.each(['', 'has space', 'a/b', 'ü', 'x'.repeat(129)])(
    'rejects the malformed key %j with 400 VALIDATION_FAILED',
    async (key) => {
      const h = setup();
      const res = await h.post({ name: 'x' }, { key });
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorBody>().error.code).toBe('VALIDATION_FAILED');
      expect(h.created).toHaveLength(0);
    },
  );

  it('accepts a 128 character key', async () => {
    const h = setup();
    expect((await h.post({ name: 'x' }, { key: 'k'.repeat(128) })).statusCode).toBe(201);
  });

  it('stores only the response, never the request body', async () => {
    const h = setup();
    await h.post({ name: 'Secret Person' }, { key: 'k1' });
    const replay = await h.post({ name: 'Secret Person' }, { key: 'k1' });
    expect(JSON.stringify(replay.json())).not.toContain('Secret');
  });
});

describe('idempotencyDocumentId', () => {
  it('joins uid and key and refuses ":" or "/" in either part', () => {
    expect(idempotencyDocumentId({ adminUid: 'u1', key: 'k-1' })).toBe('u1:k-1');
    expect(() => idempotencyDocumentId({ adminUid: 'a:b', key: 'k' })).toThrow();
    expect(() => idempotencyDocumentId({ adminUid: 'a/b', key: 'k' })).toThrow();
    expect(() => idempotencyDocumentId({ adminUid: 'a', key: 'k/1' })).toThrow();
  });
});

describe('request hashing', () => {
  it('is independent of key order and sensitive to content', () => {
    expect(canonicalJson({ b: [1, { y: 1, x: 2 }], a: undefined })).toBe('{"b":[1,{"x":2,"y":1}]}');
    expect(requestHash('POST', '/x', { a: 1, b: 2 })).toBe(
      requestHash('POST', '/x', { b: 2, a: 1 }),
    );
    expect(requestHash('POST', '/x', { a: 1 })).not.toBe(requestHash('POST', '/x', { a: 2 }));
    expect(requestHash('POST', '/x', { a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
