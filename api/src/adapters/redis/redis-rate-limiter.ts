import type { Redis } from 'ioredis';
import type { Clock, RateLimit, RateLimiter, RateLimitResult } from '../../ports/index.js';
import type { QueueLogger } from '../in-process/task-queue.js';

/**
 * Sliding-window counter over two adjacent windows (same model as the in-process adapter):
 * the window is anchored at the first request after a quiet period; the previous window weighs
 * `1 - elapsed/windowMs`. Runs atomically in Redis, so all instances share one counter.
 * ARGV: now(ms), limit, windowMs. Returns {allowed, remaining, resetAtMs}.
 */
export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local w = tonumber(ARGV[3])
local h = redis.call('HMGET', key, 's', 'c', 'p')
local start = tonumber(h[1])
local cur = tonumber(h[2]) or 0
local prev = tonumber(h[3]) or 0
if start == nil or now < start then
  if start == nil then start = now end
  now = math.max(now, start)
end
local elapsed = now - start
if elapsed >= 2 * w then
  start = now; prev = 0; cur = 0; elapsed = 0
elseif elapsed >= w then
  start = start + w; prev = cur; cur = 0; elapsed = now - start
end
local weight = math.max(0, 1 - elapsed / w)
local estimate = prev * weight + cur
local allowed = (estimate + 1 <= limit + 1e-9)
local remaining = 0
local reset
if allowed then
  cur = cur + 1
  remaining = math.max(0, math.floor(limit - estimate - 1 + 1e-9))
  reset = start + w
else
  local x
  if cur >= limit then
    x = start + w + w * math.max(0, 1 - (limit - 1) / cur)
  else
    x = start + w * math.max(0, 1 - (limit - cur - 1) / prev)
  end
  reset = math.ceil(x) + 1
end
redis.call('HSET', key, 's', start, 'c', cur, 'p', prev)
redis.call('PEXPIRE', key, 2 * w + 1000)
return {allowed and 1 or 0, remaining, reset}
`;

/** `RATE_LIMITER=redis`. Throws when Redis fails; wrap with {@link FallbackRateLimiter} for degradation. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly clock: Clock,
    private readonly prefix = 'rl:',
  ) {}

  async consume(key: string, { limit, windowMs }: RateLimit): Promise<RateLimitResult> {
    const result = (await this.redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      `${this.prefix}${key}`,
      String(this.clock.now().getTime()),
      String(limit),
      String(windowMs),
    )) as [number, number, number];
    return { allowed: result[0] === 1, remaining: result[1], resetAt: new Date(result[2]) };
  }

  close(): void {
    this.redis.disconnect();
  }
}

export interface FallbackOptions {
  /** After a Redis failure the in-memory limiter is used for this long before Redis is tried again. */
  cooldownMs?: number;
}

/**
 * Uses `primary` (Redis); when it fails, logs once per cooldown and serves from `fallback`
 * (per-instance, in memory). Never rejects because of Redis: limits keep applying per instance
 * (fail-open with respect to the shared limit, fail-closed for nothing).
 */
export class FallbackRateLimiter implements RateLimiter {
  private downUntil = 0;

  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
    private readonly clock: Clock,
    private readonly logger: Pick<QueueLogger, 'warn'>,
    private readonly options: FallbackOptions = {},
  ) {}

  async consume(key: string, limit: RateLimit): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    if (now >= this.downUntil) {
      try {
        return await this.primary.consume(key, limit);
      } catch (err) {
        this.downUntil = now + (this.options.cooldownMs ?? 5_000);
        this.logger.warn(
          { error: err instanceof Error ? err.name : 'non-error thrown' },
          'redis rate limiter unavailable; using per-instance in-memory limits',
        );
      }
    }
    return this.fallback.consume(key, limit);
  }

  close(): void {
    for (const l of [this.primary, this.fallback]) (l as { close?: () => void }).close?.();
  }
}
