import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InProcessRateLimiter,
  MAX_RATE_LIMIT_KEYS,
} from '../../src/adapters/in-process/rate-limiter.js';
import { FakeClock } from '../../src/testing/fakes/index.js';

const rule = { limit: 10, windowMs: 60_000 };

describe('InProcessRateLimiter (sliding window)', () => {
  const clock = new FakeClock();
  let limiter: InProcessRateLimiter;
  const make = (options?: ConstructorParameters<typeof InProcessRateLimiter>[1]) => {
    limiter = new InProcessRateLimiter(clock, options);
    return limiter;
  };
  afterEach(() => {
    limiter.close();
    vi.useRealTimers();
  });

  it('weights the previous window so a burst at the edge does not double the limit', async () => {
    make();
    for (let i = 0; i < 5; i++) await limiter.consume('k', rule); // t0
    clock.advance(50_000);
    for (let i = 0; i < 5; i++) await limiter.consume('k', rule); // t0 + 50 s
    clock.advance(15_000); // t0 + 65 s: 90% of the older requests are still inside the last minute
    expect((await limiter.consume('k', rule)).allowed).toBe(true);
    expect((await limiter.consume('k', rule)).allowed).toBe(false);
    clock.advance(55_000); // t0 + 120 s: everything aged out
    expect((await limiter.consume('k', rule)).allowed).toBe(true);
  });

  it('admits a single request again exactly windowMs later', async () => {
    make();
    const one = { limit: 1, windowMs: 10_000 };
    expect((await limiter.consume('k', one)).allowed).toBe(true);
    clock.advance(9_999);
    expect((await limiter.consume('k', one)).allowed).toBe(false);
    clock.advance(1);
    expect((await limiter.consume('k', one)).allowed).toBe(true);
  });

  it('window rollover restores access', async () => {
    make();
    for (let i = 0; i < 11; i++) await limiter.consume('k', rule);
    expect((await limiter.consume('k', rule)).allowed).toBe(false);
    clock.advance(2 * rule.windowMs);
    const result = await limiter.consume('k', rule);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('keeps at most 50 000 keys with 100 000 distinct keys and evicts the least recently used', async () => {
    make();
    for (let i = 0; i < 100_000; i++) await limiter.consume(`key-${String(i)}`, rule);
    expect(limiter.size).toBeLessThanOrEqual(MAX_RATE_LIMIT_KEYS);
    expect(limiter.size).toBe(MAX_RATE_LIMIT_KEYS);
  }, 60_000);

  it('refreshes a key on use so a hot key survives eviction', async () => {
    make({ maxKeys: 3 });
    await limiter.consume('hot', { limit: 2, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      await limiter.consume(`cold-${String(i)}`, rule);
      await limiter.consume('hot', { limit: 2, windowMs: 60_000 });
    }
    // 'hot' was used twice in this window (limit 2): it must still be denied, not reset by eviction.
    expect((await limiter.consume('hot', { limit: 2, windowMs: 60_000 })).allowed).toBe(false);
  });

  it('never runs backwards when the clock does', async () => {
    const back = new FakeClock();
    const l = new InProcessRateLimiter(back);
    try {
      for (let i = 0; i < 10; i++) await l.consume('k', rule);
      back.advance(-5 * rule.windowMs);
      expect((await l.consume('k', rule)).allowed).toBe(false);
    } finally {
      l.close();
    }
  });

  it('cleans up idle keys periodically with an unref-ed timer and stops on close()', async () => {
    vi.useFakeTimers();
    const l = new InProcessRateLimiter(clock, { cleanupIntervalMs: 1000 });
    try {
      await l.consume('idle', rule);
      expect(l.size).toBe(1);
      clock.advance(3 * rule.windowMs);
      vi.advanceTimersByTime(1000);
      expect(l.size).toBe(0);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      l.close();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('consume is fast (O(1))', async () => {
    make();
    for (let i = 0; i < 50_000; i++) await limiter.consume(`warm-${String(i)}`, rule);
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) await limiter.consume(`warm-${String(i)}`, rule);
    expect((performance.now() - start) / 10_000).toBeLessThan(0.05); // ms, i.e. < 50 us
  }, 60_000);
});
