export interface RateLimit {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Sliding-window counter per key (two adjacent fixed windows, the older one weighted by how much
 * of it still overlaps the last `windowMs`). Keys must not contain personal data (hash IPs/uids
 * first). Adapters may be approximate (a sliding-window counter can admit up to about 2x `limit` within one
 * `windowMs` for adversarial burst patterns across a window boundary; ADR 0018), and a denied request must not extend the denial indefinitely.
 */
export interface RateLimiter {
  /** Counts one request against `key`; `allowed` is false once `limit` is exceeded in the window. `resetAt` is when the window ends (allowed) or when the key is admitted again (denied). */
  consume(key: string, limit: RateLimit): Promise<RateLimitResult>;
}
