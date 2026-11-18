import { Redis } from 'ioredis';

export interface RedisConnectionOptions {
  maxRetriesPerRequest?: number | null;
  enableOfflineQueue?: boolean;
  commandTimeout?: number;
  connectTimeout?: number;
}

/** Connection shared by the Redis adapters. Auth and TLS come from the URL (`rediss://user:pass@host`). */
export function createRedis(url: string, options: RedisConnectionOptions = {}): Redis {
  const redis = new Redis(url, options);
  // Errors surface through failed commands; without a listener ioredis would print every reconnect error.
  redis.on('error', () => undefined);
  return redis;
}
