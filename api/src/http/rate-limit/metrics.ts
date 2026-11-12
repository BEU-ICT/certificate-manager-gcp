/** Minimal logger surface (pino-compatible) so tests need no pino. */
export interface MetricsLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface RateLimitMetrics {
  /** Counts one request of `scope`; `limited` when it was answered 429. */
  record(scope: string, limited: boolean): void;
  /** Logs and resets the counters of every scope that saw traffic. */
  flush(): void;
  /** Stops the timer (flushes once more). */
  close(): void;
}

export const METRICS_INTERVAL_MS = 60_000;
/** More than this share of limited requests in one interval is logged as a warning. */
const WARN_SHARE = 0.5;

/**
 * Aggregate per-scope counters, logged once per interval and only when there was traffic. Never
 * receives or logs keys, IPs or uids: only the scope name and two counts.
 */
export function createRateLimitMetrics(
  log: MetricsLogger,
  intervalMs = METRICS_INTERVAL_MS,
): RateLimitMetrics {
  const counters = new Map<string, { requests: number; limited: number }>();
  const flush = (): void => {
    for (const [scope, { requests, limited }] of counters) {
      const payload = { scope, requests, limited };
      if (limited / requests > WARN_SHARE) {
        log.warn(payload, 'rate limit: more than half of the requests were limited');
      } else {
        log.info(payload, 'rate limit summary');
      }
    }
    counters.clear();
  };
  const timer = setInterval(flush, intervalMs);
  timer.unref();
  return {
    record(scope, limited) {
      const counter = counters.get(scope) ?? { requests: 0, limited: 0 };
      counter.requests += 1;
      if (limited) counter.limited += 1;
      counters.set(scope, counter);
    },
    flush,
    close() {
      clearInterval(timer);
      flush();
    },
  };
}
