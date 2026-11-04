export interface RateLimit {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/** Fixed-window counter per key. Keys must not contain personal data (hash IPs/uids first). */
export interface RateLimiter {
  /** Counts one request against `key`; `allowed` is false once `limit` is exceeded in the window. */
  consume(key: string, limit: RateLimit): Promise<RateLimitResult>;
}
