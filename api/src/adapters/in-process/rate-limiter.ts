import type { Clock, RateLimit, RateLimiter, RateLimitResult } from '../../ports/index.js';

/** Hard cap on tracked keys; the least recently used key is evicted beyond it. */
export const MAX_RATE_LIMIT_KEYS = 50_000;
const CLEANUP_INTERVAL_MS = 60_000;
/** Absorbs floating-point error when the weighted estimate is compared with the limit. */
const EPSILON = 1e-9;

interface Span {
  /** Allowed requests in the window. */
  count: number;
  /** Times of the first and last allowed request in the window (valid when `count > 0`). */
  first: number;
  last: number;
}

interface Entry {
  /** Start of the current window (anchored at the first request after a quiet period). */
  start: number;
  windowMs: number;
  current: Span;
  /** The window before the current one. */
  prev: Span;
}

const emptySpan = (): Span => ({ count: 0, first: 0, last: 0 });

/**
 * Share of the previous window's requests still inside `(now - windowMs, now]`, assuming they
 * were spread evenly between its first and last request (tighter than assuming the whole window).
 */
function overlap(prev: Span, now: number, windowMs: number): number {
  if (prev.count === 0) return 0;
  const cutoff = now - windowMs;
  if (prev.last <= cutoff) return 0;
  const span = prev.last - prev.first;
  return span <= 0 ? 1 : Math.min(1, (prev.last - cutoff) / span);
}

export interface InProcessRateLimiterOptions {
  maxKeys?: number;
  cleanupIntervalMs?: number;
}

/**
 * Sliding-window counter in process memory: the estimate is `prev * overlap + count` over two
 * adjacent fixed windows (`overlap`: share of the older window still inside the last `windowMs`),
 * so a burst at a window edge cannot double the limit.
 * `consume` is O(1). Memory is bounded (`maxKeys`, LRU eviction through `Map` insertion order) and
 * an unref'd timer drops idle keys; call `close()` to stop it. Time never runs backwards: a clock
 * reading earlier than the last one seen is treated as the last one.
 *
 * Correct for a single instance only: limits are per instance on Cloud Run until a shared-store
 * adapter replaces it (BEU-ICT/certificate-manager#427).
 */
export class InProcessRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly maxKeys: number;
  private readonly timer: NodeJS.Timeout;
  private lastSeen = 0;

  constructor(
    private readonly clock: Clock,
    options: InProcessRateLimiterOptions = {},
  ) {
    this.maxKeys = options.maxKeys ?? MAX_RATE_LIMIT_KEYS;
    this.timer = setInterval(() => {
      this.sweep();
    }, options.cleanupIntervalMs ?? CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  /** Number of tracked keys (for tests and metrics). */
  get size(): number {
    return this.entries.size;
  }

  /** Stops the cleanup timer. */
  close(): void {
    clearInterval(this.timer);
  }

  consume(key: string, { limit, windowMs }: RateLimit): Promise<RateLimitResult> {
    const now = this.tick();
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key); // re-inserted below: most recently used goes last
      entry.windowMs = windowMs;
      this.roll(entry, now);
    } else {
      entry = { start: now, windowMs, current: emptySpan(), prev: emptySpan() };
    }
    this.entries.set(key, entry);
    if (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }

    const estimate = entry.prev.count * overlap(entry.prev, now, windowMs) + entry.current.count;
    const allowed = estimate + 1 <= limit + EPSILON;
    if (allowed) {
      const { current } = entry;
      if (current.count === 0) current.first = now;
      current.last = now;
      current.count += 1;
    }
    return Promise.resolve({
      allowed,
      remaining: allowed ? Math.max(0, Math.floor(limit - estimate - 1 + EPSILON)) : 0,
      resetAt: new Date(allowed ? entry.start + windowMs : retryAt(entry, limit, windowMs)),
    });
  }

  private tick(): number {
    this.lastSeen = Math.max(this.lastSeen, this.clock.now().getTime());
    return this.lastSeen;
  }

  private roll(entry: Entry, now: number): void {
    const elapsed = now - entry.start;
    if (elapsed >= 2 * entry.windowMs) {
      entry.start = now;
      entry.prev = emptySpan();
      entry.current = emptySpan();
    } else if (elapsed >= entry.windowMs) {
      entry.start += entry.windowMs;
      entry.prev = entry.current;
      entry.current = emptySpan();
    }
  }

  private sweep(): void {
    const now = this.tick();
    for (const [key, entry] of this.entries) {
      if (now - entry.start >= 2 * entry.windowMs) this.entries.delete(key);
    }
  }
}

/** Earliest time a denied key is admitted again (enough of the older requests must age out). */
function retryAt(entry: Entry, limit: number, windowMs: number): number {
  const end = entry.start + windowMs;
  if (limit < 1) return end;
  /** Time at which only `budget` of `span.count` requests are still inside the window. */
  const ageOut = (span: Span, budget: number): number => {
    const length = span.last - span.first;
    const keep = span.count <= 0 ? 0 : Math.max(0, budget / span.count);
    return span.last + windowMs - (length > 0 ? keep * length : 0);
  };
  if (entry.current.count < limit) {
    // Inside the current window: only the previous window has to shrink.
    return ageOut(entry.prev, limit - entry.current.count - 1);
  }
  // The current window is full: it becomes the previous one when the next window starts.
  return Math.max(end, ageOut(entry.current, limit - 1));
}
