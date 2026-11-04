import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('buildApp', () => {
  it('builds without environment variables or network', async () => {
    const app = buildApp();
    await app.ready();
    await app.close();
  });

  it('serves GET /internal/healthz', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('does not send X-Powered-By', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('rejects bodies over 1 MB', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/internal/healthz',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'a'.repeat(1024 * 1024 + 1) }),
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });
});
