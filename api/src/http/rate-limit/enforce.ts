import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { RateLimit, RateLimiter } from '../../ports/index.js';
import { RateLimitedError } from '../../shared/errors.js';
import type { RateLimitMetrics } from './metrics.js';

export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Short stable digest so keys never hold a plaintext IP. */
export const hashKeyPart = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

export interface EnforceInput {
  limiter: RateLimiter;
  /** Metrics label, e.g. `public`, `admin`, `admin-preauth`, `internal`. */
  scope: string;
  key: string;
  limit: number;
  /** Epoch milliseconds (the injected clock in tests). */
  now: () => number;
  reply: FastifyReply;
  metrics?: RateLimitMetrics | undefined;
}

/**
 * Counts one request. Sets `RateLimit-Limit/Remaining/Reset` (seconds) on the reply; when the
 * budget is exhausted also throws `RateLimitedError` (429 `RATE_LIMITED` with `Retry-After`), which
 * the shared error handler renders with the headers set here.
 */
export async function enforceRateLimit(input: EnforceInput): Promise<void> {
  const rule: RateLimit = { limit: input.limit, windowMs: RATE_LIMIT_WINDOW_MS };
  const result = await input.limiter.consume(input.key, rule);
  const resetSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - input.now()) / 1000));
  input.metrics?.record(input.scope, !result.allowed);
  input.reply.headers({
    'ratelimit-limit': String(input.limit),
    'ratelimit-remaining': String(result.remaining),
    'ratelimit-reset': String(resetSeconds),
  });
  if (!result.allowed) throw new RateLimitedError(resetSeconds);
}
