import { describe, it } from 'vitest';
import type { Clock, RateLimiter } from '../../ports/index.js';
import { clause, type AdapterHandle } from './types.js';

const PORT = 'RateLimiter';
const FIXED = 'RateLimiter: Fixed-window counter per key';
const CONSUME =
  'consume: Counts one request against key; allowed is false once limit is exceeded in the window';

/**
 * Rate limiting depends on time, so the factory also hands the suite the clock the adapter reads
 * and a way to move it. Adapters backed by a real clock (a shared store) implement `advance` by
 * sleeping, or by using a window short enough to wait out.
 */
export interface RateLimiterHandle extends AdapterHandle<RateLimiter> {
  clock: Clock;
  advance: (ms: number) => Promise<void> | void;
}

export type RateLimiterContractFactory = () => Promise<RateLimiterHandle> | RateLimiterHandle;

/** Executable form of the TSDoc on `RateLimiter` (src/ports/rate-limiter.ts). */
export function describeRateLimiterContract(
  name: string,
  factory: RateLimiterContractFactory,
): void {
  const test = (title: string, body: (handle: RateLimiterHandle) => Promise<void>) =>
    it(title, async () => {
      const handle = await factory();
      try {
        await body(handle);
      } finally {
        await handle.cleanup();
      }
    });

  const rule = { limit: 3, windowMs: 60_000 };

  describe(`RateLimiter contract: ${name}`, () => {
    test('allows up to limit requests, then denies', async ({ adapter }) => {
      for (let i = 1; i <= rule.limit; i++) {
        const result = await adapter.consume('k', rule);
        clause(PORT, CONSUME, `request ${i} of ${rule.limit} must be allowed`)
          .that(result.allowed)
          .toBe(true);
        clause(PORT, 'RateLimitResult.remaining: requests left in the window', `after request ${i}`)
          .that(result.remaining)
          .toBe(rule.limit - i);
      }
      const denied = await adapter.consume('k', rule);
      clause(PORT, CONSUME, 'request beyond limit must be denied').that(denied.allowed).toBe(false);
      clause(PORT, 'RateLimitResult.remaining: never negative', 'denied request')
        .that(denied.remaining)
        .toBe(0);
    });

    test('keeps counting denied requests inside the window', async ({ adapter }) => {
      for (let i = 0; i < 6; i++) await adapter.consume('k', rule);
      clause(PORT, CONSUME, 'still exceeded later in the same window')
        .that((await adapter.consume('k', rule)).allowed)
        .toBe(false);
    });

    test('resetAt marks the end of the window and is stable inside it', async ({
      adapter,
      clock,
      advance,
    }) => {
      const start = clock.now().getTime();
      const first = await adapter.consume('k', rule);
      clause(PORT, 'RateLimitResult.resetAt: when the window ends', 'first request')
        .that(first.resetAt.getTime())
        .toBe(start + rule.windowMs);
      await advance(10_000);
      const second = await adapter.consume('k', rule);
      clause(PORT, FIXED, 'the window does not slide with later requests')
        .that(second.resetAt.getTime())
        .toBe(first.resetAt.getTime());
    });

    test('a new window starts after windowMs and the counter restarts', async ({
      adapter,
      advance,
    }) => {
      for (let i = 0; i < rule.limit + 1; i++) await adapter.consume('k', rule);
      await advance(rule.windowMs - 1);
      clause(PORT, FIXED, 'one millisecond before the window ends')
        .that((await adapter.consume('k', rule)).allowed)
        .toBe(false);
      await advance(1);
      const fresh = await adapter.consume('k', rule);
      clause(PORT, FIXED, 'window elapsed, counter must restart').that(fresh.allowed).toBe(true);
      clause(PORT, FIXED, 'restarted counter counts the new request')
        .that(fresh.remaining)
        .toBe(rule.limit - 1);
    });

    test('keys are counted independently', async ({ adapter }) => {
      for (let i = 0; i < rule.limit + 1; i++) await adapter.consume('a', rule);
      clause(PORT, FIXED + ' (per key)', 'exhausting key "a" must not affect key "b"')
        .that((await adapter.consume('b', rule)).allowed)
        .toBe(true);
    });

    test('concurrent consume calls never allow more than limit', async ({ adapter }) => {
      const results = await Promise.all(
        Array.from({ length: 25 }, () => adapter.consume('burst', rule)),
      );
      clause(PORT, CONSUME, 'allowed results among 25 concurrent calls')
        .that(results.filter((r) => r.allowed))
        .toHaveLength(rule.limit);
      clause(PORT, 'RateLimitResult.remaining: never negative', 'concurrent calls')
        .that(results.every((r) => r.remaining >= 0))
        .toBe(true);
    });
  });
}
