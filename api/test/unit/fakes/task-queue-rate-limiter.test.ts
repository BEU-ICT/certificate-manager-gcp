import { describe, expect, it } from 'vitest';
import type { Clock, RateLimiter, TaskQueue } from '../../../src/ports/index.js';
import { FakeClock, FakeRateLimiter, FakeTaskQueue } from '../../../src/testing/fakes/index.js';

/** Reusable behaviours every TaskQueue must show. */
export function taskQueueBehaviour(make: () => TaskQueue): void {
  const task = (name: string, dedupe: boolean) => ({
    name,
    handler: '/internal/tasks/x',
    payload: { id: 1 },
    dedupe,
  });

  it('creates a task and de-duplicates by name when dedupe is true', async () => {
    const q = make();
    expect(await q.enqueue(task('a', true))).toEqual({ created: true });
    expect(await q.enqueue(task('a', true))).toEqual({ created: false });
    expect(await q.enqueue(task('b', true))).toEqual({ created: true });
  });
}

/** Reusable behaviours every RateLimiter must show; `clock` drives time. */
export function rateLimiterBehaviour(make: () => { limiter: RateLimiter; clock: FakeClock }): void {
  const limit = { limit: 2, windowMs: 1000 };

  it('allows up to the limit then denies, with decreasing remaining', async () => {
    const { limiter } = make();
    const r = [
      await limiter.consume('k', limit),
      await limiter.consume('k', limit),
      await limiter.consume('k', limit),
    ];
    expect(r.map((x) => x.allowed)).toEqual([true, true, false]);
    expect(r.map((x) => x.remaining)).toEqual([1, 0, 0]);
  });

  it('counts keys independently and resets after the window', async () => {
    const { limiter, clock } = make();
    await limiter.consume('k', limit);
    await limiter.consume('k', limit);
    expect((await limiter.consume('other', limit)).allowed).toBe(true);
    clock.advance(999);
    expect((await limiter.consume('k', limit)).allowed).toBe(false);
    clock.advance(1);
    const fresh = await limiter.consume('k', limit);
    expect(fresh).toMatchObject({ allowed: true, remaining: 1 });
  });

  it('reports the window end as resetAt', async () => {
    const { limiter, clock } = make();
    const start = clock.now().getTime();
    const r = await limiter.consume('k', limit);
    expect(r.resetAt.getTime()).toBe(start + 1000);
  });
}

describe('FakeTaskQueue', () => {
  taskQueueBehaviour(() => new FakeTaskQueue());

  it('records tasks, skips duplicates, and records non-dedupe repeats', async () => {
    const q = new FakeTaskQueue();
    const base = { name: 'n', handler: '/h', payload: {} };
    await q.enqueue({ ...base, dedupe: true });
    await q.enqueue({ ...base, dedupe: true });
    await q.enqueue({ ...base, dedupe: false });
    expect(q.tasks).toHaveLength(2);
    expect(q.drain()).toHaveLength(2);
    expect(q.tasks).toHaveLength(0);
  });
});

describe('FakeRateLimiter', () => {
  rateLimiterBehaviour(() => {
    const clock: Clock & FakeClock = new FakeClock();
    return { limiter: new FakeRateLimiter(clock), clock };
  });
});
