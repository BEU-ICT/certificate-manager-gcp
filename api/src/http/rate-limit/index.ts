import type { FastifyInstance } from 'fastify';
import type { RateLimiter } from '../../ports/index.js';
import { getClientIp } from '../client-ip.js';
import { enforceRateLimit, hashKeyPart } from './enforce.js';
import { createRateLimitMetrics, type RateLimitMetrics } from './metrics.js';

export { enforceRateLimit, hashKeyPart, RATE_LIMIT_WINDOW_MS } from './enforce.js';
export { createRateLimitMetrics, type RateLimitMetrics } from './metrics.js';

/** Default budget per authenticated admin (`RATE_LIMIT_ADMIN_PER_MIN` overrides, validated 30-100). */
export const ADMIN_PER_MIN = 60;
/**
 * Default pre-authentication budget per client IP on `/api/v1/admin/**`: twice the per-admin
 * budget, so a valid admin can reach their own limit and a few admins can share a NAT. It exists
 * to throttle token guessing, not legitimate traffic (deliberate deviation from the issue's 30).
 */
export const ADMIN_PRE_AUTH_FACTOR = 2;
export const ADMIN_PRE_AUTH_PER_MIN = ADMIN_PRE_AUTH_FACTOR * ADMIN_PER_MIN;
/**
 * Budget per client IP on `/internal/**`. Cloud Tasks traffic must never be lost: the queue
 * dispatches about 1 task/s (60/min), so 120/min leaves 2x headroom, and a 429 is a non-2xx answer
 * that Cloud Tasks retries with backoff, so even a burst over the budget is delayed, not dropped.
 * It only exists to stop floods of forged requests, which fail authentication anyway.
 */
export const INTERNAL_PER_MIN = 120;

const PUBLIC_PREFIX = '/api/v1/public';
const INTERNAL_PREFIX = '/internal';

export interface EdgeRateLimitDeps {
  limiter: RateLimiter;
  now: () => number;
  metrics: RateLimitMetrics;
  /** One shared budget per client IP for every `/api/v1/public/**` route. */
  publicPerMin: number;
  internalPerMin?: number | undefined;
}

const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Root `onRequest` hook for the unauthenticated surfaces. It runs before routing-dependent logic,
 * validation and any handler (so a limited request costs zero database reads) and also for the
 * wildcard and unmatched 404s under the prefixes, so unknown and malformed IDs consume the same
 * budget as valid ones. Must be installed before the routes are registered. Keys hold only a hash of
 * `getClientIp`, never client-supplied identity beyond the trusted proxy hop.
 */
export function installEdgeRateLimits(app: FastifyInstance, deps: EdgeRateLimitDeps): void {
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?', 1)[0] ?? '';
    const isPublic = under(path, PUBLIC_PREFIX);
    if (!isPublic && !under(path, INTERNAL_PREFIX)) return;
    const scope = isPublic ? 'public' : 'internal';
    await enforceRateLimit({
      limiter: deps.limiter,
      scope,
      key: `${scope}:${hashKeyPart(getClientIp(request))}`,
      limit: isPublic ? deps.publicPerMin : (deps.internalPerMin ?? INTERNAL_PER_MIN),
      now: deps.now,
      reply,
      metrics: deps.metrics,
    });
  });
}

/** Creates the metrics reporter and stops it with the app. */
export function installRateLimitMetrics(
  app: FastifyInstance,
  intervalMs?: number,
): RateLimitMetrics {
  const metrics = createRateLimitMetrics(app.log, intervalMs);
  app.addHook('onClose', () => {
    metrics.close();
  });
  return metrics;
}
