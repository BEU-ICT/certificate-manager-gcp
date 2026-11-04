import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../../src/testing/context.js';

describe('createTestContext', () => {
  it('builds a working app with fakes and an admin identity', async () => {
    const ctx = createTestContext();
    const res = await ctx.app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(res.statusCode).toBe(200);
    await expect(
      ctx.fakes.tokenVerifier.verify(ctx.adminAuthorization.replace('Bearer ', '')),
    ).resolves.toEqual(ctx.admin);
    await expect(
      ctx.fakes.taskRequestVerifier.verify(ctx.taskAuthorization),
    ).resolves.toBeDefined();
    await ctx.close();
  });

  it('gives each context isolated state', async () => {
    const a = createTestContext();
    const b = createTestContext();
    await a.fakes.taskQueue.enqueue({ name: 'n', handler: '/h', payload: {}, dedupe: true });
    expect(b.fakes.taskQueue.tasks).toHaveLength(0);
    await a.close();
    await b.close();
  });
});
