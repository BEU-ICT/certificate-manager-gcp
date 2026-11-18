import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { BullMqQueue, TaskWorker } from '../../src/adapters/bullmq/bullmq-queue.js';
import {
  FallbackRateLimiter,
  RedisRateLimiter,
} from '../../src/adapters/redis/redis-rate-limiter.js';
import { InProcessRateLimiter } from '../../src/adapters/in-process/rate-limiter.js';
import { SystemClock } from '../../src/adapters/system/clock.js';
import {
  describeRateLimiterContract,
  describeTaskQueueContract,
} from '../../src/testing/contracts/index.js';
import { FakeClock } from '../../src/testing/fakes/index.js';

// Needs a Redis (CI service container; locally `docker run -p 6379:6379 redis:7`).
const url = process.env['REDIS_URL'];
const suite = url ? describe : describe.skip;
const connect = () => new Redis(url ?? '', { maxRetriesPerRequest: null });
const noop = { warn: () => undefined, error: () => undefined };
const opened: Redis[] = [];
const open = () => {
  const r = connect();
  opened.push(r);
  return r;
};
afterAll(async () => {
  await Promise.all(opened.map((r) => r.quit().catch(() => undefined)));
});

if (url) {
  const prefix = `rl-test-${randomUUID()}:`;
  describeRateLimiterContract('RedisRateLimiter', () => {
    const clock = new FakeClock();
    const redis = open();
    return {
      adapter: new RedisRateLimiter(redis, clock, `${prefix}${randomUUID()}:`),
      clock,
      advance: (ms) => clock.advance(ms),
      cleanup: () => undefined,
    };
  });

  describeTaskQueueContract('BullMqQueue', () => {
    const bullPrefix = `bull-test-${randomUUID()}`;
    // Fixed clock: delays are exact, so the queue's scheduled times can be compared with the suite's.
    const clock = new FakeClock(new Date('2030-01-01T00:00:00.000Z'));
    const queue = new BullMqQueue({ connection: open(), clock, prefix: bullPrefix });
    return {
      adapter: queue,
      cleanup: async () => {
        await queue.queue.obliterate({ force: true });
        await queue.close();
      },
      pending: async () =>
        (await queue.queue.getJobs(['delayed', 'waiting'])).map((j) => ({
          name: j.id ?? '',
          scheduleAt: j.delay > 0 ? new Date(clock.now().getTime() + j.delay) : undefined,
        })),
    };
  });
}

suite('BullMQ worker', () => {
  it('does not run a task twice across worker restarts (dedupe) and passes retryCount', async () => {
    const prefix = `bull-test-${randomUUID()}`;
    const queue = new BullMqQueue({ connection: open(), clock: new SystemClock(), prefix });
    const calls: Array<{ payload: unknown; retryCount: number | undefined }> = [];
    const handlers = new Map([
      [
        '/internal/tasks/test',
        (payload: unknown, info?: { retryCount: number }) => {
          calls.push({ payload, retryCount: info?.retryCount });
          return Promise.resolve();
        },
      ],
    ]);
    expect(
      await queue.enqueue({
        name: 'email-c1-1',
        handler: '/internal/tasks/test',
        payload: { a: 1 },
        dedupe: true,
      }),
    ).toEqual({ created: true });
    const w1 = new TaskWorker({ connection: open(), handlers, logger: noop, prefix });
    w1.start();
    await expect.poll(() => calls.length, { timeout: 8000 }).toBe(1);
    await w1.close();
    // Restart and enqueue the same name again: still one execution.
    const w2 = new TaskWorker({ connection: open(), handlers, logger: noop, prefix });
    w2.start();
    expect(
      await queue.enqueue({
        name: 'email-c1-1',
        handler: '/internal/tasks/test',
        payload: { a: 1 },
        dedupe: true,
      }),
    ).toEqual({ created: false });
    await new Promise((r) => setTimeout(r, 2500));
    await w2.close();
    expect(calls).toEqual([{ payload: { a: 1 }, retryCount: 0 }]);
    await queue.queue.obliterate({ force: true });
    await queue.close();
  }, 20_000);

  it('delays a scheduled task', async () => {
    const prefix = `bull-test-${randomUUID()}`;
    const queue = new BullMqQueue({ connection: open(), clock: new SystemClock(), prefix });
    let ran = 0;
    const handlers = new Map([
      [
        '/internal/tasks/test',
        () => {
          ran += 1;
          return Promise.resolve();
        },
      ],
    ]);
    const w = new TaskWorker({ connection: open(), handlers, logger: noop, prefix });
    w.start();
    await queue.enqueue({
      name: 'later',
      handler: '/internal/tasks/test',
      payload: {},
      dedupe: true,
      scheduleAt: new Date(Date.now() + 3000),
    });
    await new Promise((r) => setTimeout(r, 1200));
    expect(ran).toBe(0);
    await expect.poll(() => ran, { timeout: 8000 }).toBe(1);
    await w.close();
    await queue.queue.obliterate({ force: true });
    await queue.close();
  }, 20_000);
});

describe('FallbackRateLimiter', () => {
  it('serves from memory while Redis fails, then recovers', async () => {
    const clock = new FakeClock();
    let down = true;
    const primary = {
      consume: () =>
        down
          ? Promise.reject(new Error('ECONNREFUSED'))
          : Promise.resolve({ allowed: true, remaining: 99, resetAt: new Date(0) }),
    };
    const warnings: unknown[] = [];
    const limiter = new FallbackRateLimiter(
      primary,
      new InProcessRateLimiter(clock),
      clock,
      { warn: (o) => warnings.push(o) },
      { cooldownMs: 1000 },
    );
    const rule = { limit: 2, windowMs: 60_000 };
    expect((await limiter.consume('k', rule)).allowed).toBe(true);
    expect((await limiter.consume('k', rule)).allowed).toBe(true);
    expect((await limiter.consume('k', rule)).allowed).toBe(false);
    expect(warnings).toHaveLength(1);
    down = false;
    clock.advance(1001);
    expect((await limiter.consume('k', rule)).remaining).toBe(99);
  });
});
