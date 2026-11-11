import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiClient, getHealth } from './client';
import { ApiError } from './errors';
import { clearApiCache, queryClient, shouldRetry } from './query';

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const errorBody = (code: string, message: string, extra: object = {}) => ({
  error: { code, message, requestId: 'req-1', ...extra },
});

async function catchError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected rejection');
}

describe('api client', () => {
  it('returns parsed JSON on success and sends no token for public calls', async () => {
    let auth: string | null = 'unset';
    server.use(
      http.get('*/api/v1/health', ({ request }) => {
        auth = request.headers.get('Authorization');
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    const getToken = vi.fn(() => Promise.resolve('tok'));
    const client = createApiClient({ getToken });
    await expect(getHealth(client)).resolves.toEqual({ status: 'ok' });
    expect(auth).toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('attaches the bearer token on /admin calls', async () => {
    let auth: string | null = null;
    server.use(
      http.get('*/api/v1/admin/things', ({ request }) => {
        auth = request.headers.get('Authorization');
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const client = createApiClient({ getToken: () => Promise.resolve('tok') });
    await client.get('/admin/things', { query: { limit: 5, skip: undefined } });
    expect(auth).toBe('Bearer tok');
  });

  it('maps a validation error with details and request id', async () => {
    server.use(
      http.post('*/api/v1/admin/things', () =>
        HttpResponse.json(
          errorBody('VALIDATION_FAILED', 'Bad input', {
            details: [{ path: 'items[3].email', message: 'Invalid email' }],
          }),
          { status: 400 },
        ),
      ),
    );
    const client = createApiClient({ getToken: () => Promise.resolve('t') });
    const err = await catchError(client.post('/admin/things', { a: 1 }));
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Bad input',
      requestId: 'req-1',
      details: [{ path: 'items[3].email', message: 'Invalid email' }],
    });
  });

  it('never exposes raw server text for 5xx', async () => {
    server.use(
      http.get('*/api/v1/health', () =>
        HttpResponse.json(errorBody('INTERNAL', 'SELECT * FROM secrets at /srv/app.js'), {
          status: 500,
        }),
      ),
    );
    const err = await catchError(getHealth(createApiClient()));
    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL');
    expect(err.message).not.toContain('SELECT');
    expect(err.details).toBeUndefined();
  });

  it('refreshes the token once on 401 and retries successfully', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/api/v1/admin/me', ({ request }) => {
        const header = request.headers.get('Authorization');
        seen.push(header);
        return header === 'Bearer fresh'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json(errorBody('UNAUTHENTICATED', 'expired'), { status: 401 });
      }),
    );
    const getToken = vi.fn((force: boolean) => Promise.resolve(force ? 'fresh' : 'stale'));
    const onUnauthorized = vi.fn();
    const client = createApiClient({ getToken, onUnauthorized });
    await expect(client.get('/admin/me')).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(getToken.mock.calls).toEqual([[false], [true]]);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out after a second 401 (no further retries)', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/v1/admin/me', () => {
        calls += 1;
        return HttpResponse.json(errorBody('UNAUTHENTICATED', 'nope'), { status: 401 });
      }),
    );
    const onUnauthorized = vi.fn();
    const client = createApiClient({ getToken: () => Promise.resolve('t'), onUnauthorized });
    const err = await catchError(client.get('/admin/me'));
    expect(err.status).toBe(401);
    expect(calls).toBe(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not retry 401 or sign out on public calls', async () => {
    server.use(
      http.get('*/api/v1/health', () =>
        HttpResponse.json(errorBody('UNAUTHENTICATED', 'x'), { status: 401 }),
      ),
    );
    const onUnauthorized = vi.fn();
    const client = createApiClient({ getToken: () => Promise.resolve('t'), onUnauthorized });
    await catchError(getHealth(client));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('surfaces retryAfterSeconds on 429', async () => {
    server.use(
      http.get('*/api/v1/health', () =>
        HttpResponse.json(errorBody('RATE_LIMITED', 'Slow down'), {
          status: 429,
          headers: { 'Retry-After': '17' },
        }),
      ),
    );
    const err = await catchError(getHealth(createApiClient()));
    expect(err).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 17 });
  });

  it('turns network failures into code NETWORK', async () => {
    server.use(http.get('*/api/v1/health', () => HttpResponse.error()));
    const err = await catchError(getHealth(createApiClient()));
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
    expect(err.isNetwork).toBe(true);
  });

  it('propagates caller aborts untouched', async () => {
    server.use(
      http.get('*/api/v1/health', async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    const controller = new AbortController();
    const promise = getHealth(createApiClient(), controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await expect(promise).rejects.not.toBeInstanceOf(ApiError);
  });

  it('reports a timeout as TIMEOUT', async () => {
    server.use(
      http.get('*/api/v1/health', async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return HttpResponse.json({ status: 'ok' });
      }),
    );
    const err = await catchError(createApiClient().get('/health', { timeoutMs: 20 }));
    expect(err.code).toBe('TIMEOUT');
  });
});

describe('api client: FormData with onUploadProgress (XHR path)', () => {
  const form = () => {
    const f = new FormData();
    f.append('a', new File(['hello'], 'a.txt'));
    return f;
  };
  const upload = (client: ReturnType<typeof createApiClient>, extra: object = {}) =>
    client.post('/admin/templates', form(), { onUploadProgress: () => undefined, ...extra });

  it('attaches the token, parses the response and reads headers', async () => {
    let auth: string | null = null;
    let sent: FormData | undefined;
    server.use(
      http.post('*/api/v1/admin/templates', async ({ request }) => {
        auth = request.headers.get('Authorization');
        sent = await request.formData();
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );
    const client = createApiClient({ getToken: () => Promise.resolve('tok') });
    await expect(upload(client)).resolves.toEqual({ ok: true });
    expect(auth).toBe('Bearer tok');
    expect((sent?.get('a') as File).name).toBe('a.txt');
  });

  it('maps error bodies and the request id header', async () => {
    server.use(
      http.post('*/api/v1/admin/templates', () =>
        HttpResponse.json(
          errorBody('TEMPLATE_INVALID', 'bad', {
            details: [{ path: 'p', message: 'm', code: 'SVG_SCRIPT', file: 'background.svg' }],
          }),
          { status: 422, headers: { 'X-Request-Id': 'hdr-1' } },
        ),
      ),
    );
    const err = await catchError(upload(createApiClient()));
    expect(err.status).toBe(422);
    expect(err.details).toEqual([
      { path: 'p', message: 'm', code: 'SVG_SCRIPT', file: 'background.svg' },
    ]);
  });

  it('handles 204 without a body', async () => {
    server.use(
      http.post('*/api/v1/admin/templates', () => new HttpResponse(null, { status: 204 })),
    );
    await expect(upload(createApiClient())).resolves.toBeUndefined();
  });

  it('refreshes the token on 401 and retries with the same FormData', async () => {
    const seen: (string | null)[] = [];
    const bodies: string[] = [];
    server.use(
      http.post('*/api/v1/admin/templates', async ({ request }) => {
        const header = request.headers.get('Authorization');
        seen.push(header);
        bodies.push(String(((await request.formData()).get('a') as File).name));
        return header === 'Bearer fresh'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json(errorBody('UNAUTHENTICATED', 'expired'), { status: 401 });
      }),
    );
    const getToken = vi.fn((force: boolean) => Promise.resolve(force ? 'fresh' : 'stale'));
    const client = createApiClient({ getToken });
    await expect(upload(client)).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(bodies).toEqual(['a.txt', 'a.txt']);
  });

  it('signs out after a second 401', async () => {
    server.use(
      http.post('*/api/v1/admin/templates', () =>
        HttpResponse.json(errorBody('UNAUTHENTICATED', 'nope'), { status: 401 }),
      ),
    );
    const onUnauthorized = vi.fn();
    const client = createApiClient({ getToken: () => Promise.resolve('t'), onUnauthorized });
    const err = await catchError(upload(client));
    expect(err.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('rejects with the abort reason when the caller aborts, also when pre-aborted', async () => {
    server.use(
      http.post('*/api/v1/admin/templates', async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const running = upload(createApiClient(), { signal: controller.signal });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(running).rejects.not.toBeInstanceOf(ApiError);

    const pre = new AbortController();
    pre.abort();
    await expect(upload(createApiClient(), { signal: pre.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('reports TIMEOUT and NETWORK', async () => {
    server.use(
      http.post('*/api/v1/admin/templates', async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return HttpResponse.json({});
      }),
    );
    expect((await catchError(upload(createApiClient(), { timeoutMs: 20 }))).code).toBe('TIMEOUT');
    server.use(http.post('*/api/v1/admin/templates', () => HttpResponse.error()));
    expect((await catchError(upload(createApiClient()))).code).toBe('NETWORK');
  });
});

describe('query defaults', () => {
  it('retries only network/5xx errors, at most twice', () => {
    const e = (status: number, code = 'X') => new ApiError({ status, code, message: '' });
    expect(shouldRetry(0, e(0, 'NETWORK'))).toBe(true);
    expect(shouldRetry(1, e(503))).toBe(true);
    expect(shouldRetry(2, e(503))).toBe(false);
    expect(shouldRetry(0, e(400))).toBe(false);
    expect(shouldRetry(0, e(429))).toBe(false);
    expect(shouldRetry(0, new Error('boom'))).toBe(false);
  });

  it('clears the cache on sign-out', () => {
    queryClient.setQueryData(['x'], 1);
    clearApiCache();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient).toBeInstanceOf(QueryClient);
  });
});
