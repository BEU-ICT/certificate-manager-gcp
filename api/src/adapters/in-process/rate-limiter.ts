import type { Clock, RateLimit, RateLimiter, RateLimitResult } from '../../ports/index.js';

interface Window {
  resetAt: number;
  count: number;
}

/**
 * Fixed-window counter in process memory. Correct for a single instance only; limits are
 * per instance on Cloud Run until a shared-store adapter replaces it.
 */
export class InProcessRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly clock: Clock) {}

  consume(key: string, { limit, windowMs }: RateLimit): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    for (const [k, w] of this.windows) if (now >= w.resetAt) this.windows.delete(k);
    let window = this.windows.get(key);
    if (!window) {
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
