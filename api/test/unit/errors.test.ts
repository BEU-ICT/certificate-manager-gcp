import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  ConflictError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitedError,
  UnauthenticatedError,
  UnavailableError,
  UnprocessableError,
  ValidationError,
  type AppError,
} from '../../src/shared/errors.js';

const TRACE = '105445aa7843bc8bf206b12000100000';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

function appThrowing(throwFn: () => never): FastifyInstance {
  const instance = buildApp();
  instance.get('/boom', throwFn);
  return instance;
}

const cases: [string, () => AppError, number, string, string, Record<string, string>?][] = [
  [
    'ValidationError',
    () => new ValidationError('Bad input', [{ path: 'a.b', message: 'Required' }]),
    400,
    'VALIDATION_FAILED',
    'Bad input',
  ],
  [
    'UnauthenticatedError',
    () => new UnauthenticatedError(),
    401,
    'UNAUTHENTICATED',
    'Authentication is required',
  ],
  [
    'ForbiddenError',
    () => new ForbiddenError(),
    403,
    'FORBIDDEN',
    'You are not allowed to perform this action',
  ],
  ['NotFoundError', () => new NotFoundError(), 404, 'NOT_FOUND', 'Resource not found'],
  [
    'ConflictError',
    () => new ConflictError(),
    409,
    'CONFLICT',
    'Request conflicts with the current state',
  ],
  ['GoneError', () => new GoneError(), 410, 'GONE', 'Resource is no longer available'],
  [
    'PayloadTooLargeError',
    () => new PayloadTooLargeError(),
    413,
    'PAYLOAD_TOO_LARGE',
    'Request body is too large',
  ],
  [
    'UnprocessableError',
    () => new UnprocessableError('TEXT_DOES_NOT_FIT', 'Name does not fit'),
    422,
    'TEXT_DOES_NOT_FIT',
    'Name does not fit',
  ],
  [
    'RateLimitedError',
    () => new RateLimitedError(30),
    429,
    'RATE_LIMITED',
    'Too many requests',
    { 'retry-after': '30' },
  ],
  [
    'UnavailableError',
    () => new UnavailableError(7),
    503,
    'UNAVAILABLE',
    'Service temporarily unavailable',
    { 'retry-after': '7' },
  ],
];

describe('central error handler', () => {
  it.each(cases)('%s -> exact JSON body', async (_name, make, status, code, message, headers) => {
    app = appThrowing(() => {
      throw make();
    });
    const res = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'x-cloud-trace-context': `${TRACE}/1;o=1` },
    });
    const expectedError: Record<string, unknown> = { code, message, requestId: TRACE };
    if (_name === 'ValidationError')
      expectedError['details'] = [{ path: 'a.b', message: 'Required' }];
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: expectedError });
    expect(res.headers['x-request-id']).toBe(TRACE);
    for (const [k, v] of Object.entries(headers ?? {})) expect(res.headers[k]).toBe(v);
  });

  it('maps ZodError to VALIDATION_FAILED with details', async () => {
    app = appThrowing(() => {
      z.object({ items: z.array(z.object({ email: z.string().email() })) }).parse({
        items: [{ email: 'a@b.co' }, { email: 'nope' }],
      });
      throw new Error('unreachable');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(400);
    const body = res.json<{
      error: { code: string; message: string; details: unknown[]; requestId: string };
    }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual([
      { path: 'items[1].email', message: 'Invalid email address' },
    ]);
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('returns a generic 500 and never leaks the original message', async () => {
    app = appThrowing(() => {
      throw new Error('secret db message');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: {
        code: 'INTERNAL',
        message: 'Internal server error',
        requestId: res.headers['x-request-id'],
      },
    });
    expect(res.body).not.toContain('secret db message');
    expect(res.body).not.toContain('stack');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for oversized bodies', async () => {
    app = buildApp();
    app.post('/upload', () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'a'.repeat(1024 * 1024 + 1) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('returns 400 VALIDATION_FAILED for malformed JSON without echoing the parser message', async () => {
    app = buildApp();
    app.post('/upload', () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request could not be parsed',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('answers unknown routes with 404 NOT_FOUND in the standard format', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/nope?x=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('answers a wrong method on a known path with 405 and Allow', async () => {
    app = buildApp();
    app.get('/items/:id', () => ({}));
    const res = await app.inject({ method: 'DELETE', url: '/items/42?x=1' });
    expect(res.statusCode).toBe(405);
    expect(res.headers['allow']).toBe('GET, HEAD');
    expect(res.json()).toEqual({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('generates a UUID request ID when no trace header is present', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('route handler timeout', () => {
  it('is answered 503 UNAVAILABLE with Retry-After', async () => {
    app = buildApp();
    app.get('/slow', { handlerTimeout: 20 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {};
    });
    const res = await app.inject({ method: 'GET', url: '/slow' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNAVAILABLE');
  });
});
