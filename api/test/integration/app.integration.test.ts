import { afterEach, describe, expect, it } from 'vitest';
import { buildIntegrationApp, type IntegrationApp } from './helpers/index.js';

describe('buildIntegrationApp', () => {
  let ctx: IntegrationApp | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('serves the health endpoint', async () => {
    ctx = buildIntegrationApp();

    const res = await ctx.app.inject({ method: 'GET', url: '/internal/healthz' });

    expect(res.statusCode).toBe(200);
  });
});
