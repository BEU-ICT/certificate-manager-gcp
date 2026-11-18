import type { AdapterContext } from '../registry.js';
import { AdapterError } from '../registry.js';
import { createLogger } from '../../http/logging/logger.js';
import { InProcessRateLimiter } from '../in-process/rate-limiter.js';
import type { Clock, RateLimiter } from '../../ports/index.js';
import { createRedis } from './connection.js';
import { FallbackRateLimiter, RedisRateLimiter } from './redis-rate-limiter.js';

/** `RATE_LIMITER=redis`, with in-memory fallback while Redis is unreachable. */
export function createRateLimiter({ config }: AdapterContext, clock: Clock): RateLimiter {
  if (!config.redis.url) throw new AdapterError('RATE_LIMITER: redis needs REDIS_URL');
  // Fail fast instead of queueing commands while Redis is down.
  const redis = createRedis(config.redis.url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 500,
    connectTimeout: 2_000,
  });
  return new FallbackRateLimiter(
    new RedisRateLimiter(redis, clock),
    new InProcessRateLimiter(clock),
    clock,
    createLogger({ level: config.logLevel, gcpProject: config.gcpProject }),
  );
}
