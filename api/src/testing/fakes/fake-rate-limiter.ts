import type { Clock, RateLimit, RateLimiter, RateLimitResult } from '../../ports/index.js';

interface Window {
  resetAt: number;
  count: number;
}

/** Fixed-window counter per key; the window starts at the first request after the previous one expired. */
export class FakeRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly clock: Clock) {}

  consume(key: string, { limit, windowMs }: RateLimit): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    let window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      window = { resetAt: now + windowMs, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return Promise.resolve({
      allowed: window.count <= limit,
      remaining: Math.max(0, limit - window.count),
      resetAt: new Date(window.resetAt),
    });
  }
}
