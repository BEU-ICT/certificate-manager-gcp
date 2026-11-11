import { UnavailableError } from '../../shared/errors.js';

/** Defaults of BEU-ICT/certificate-manager#328 (budgets: BEU-ICT/certificate-manager#236 section 7). */
export const DEFAULT_MAX_CONCURRENT_RENDERS = 3;
export const DEFAULT_QUEUE_WAIT_MS = 10_000;
export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
export const RENDER_RETRY_AFTER_SECONDS = 5;
/** Hard cap of a rendered PDF (typical size is about 500 KB; larger usually means an unoptimised image). */
export const MAX_PDF_BYTES = 2 * 1024 * 1024;

export interface RenderLimiterOptions {
  /** `PDF_MAX_CONCURRENT_RENDERS`; default 3. */
  maxConcurrent?: number;
  /** Longest a request waits for a permit before `UnavailableError`; default 10 s. */
  queueWaitMs?: number;
  /** `PDF_RENDER_TIMEOUT_MS`; default 30 s. */
  timeoutMs?: number;
  /** Monotonic millisecond timer; default `performance.now`. */
  timer?: () => number;
}

export interface LimitedResult<T> {
  value: T;
  /** Milliseconds spent waiting for a permit. */
  queuedMs: number;
}

interface Waiter {
  grant: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Module-internal semaphore for PDF renders: at most `maxConcurrent` run at once, others queue for
 * up to `queueWaitMs` and then fail with `UnavailableError` (503, `Retry-After: 5`). The task gets
 * an `AbortSignal` that fires after `timeoutMs`; the permit is released on success, failure and
 * timeout alike (even when the task ignores the signal), so a failed render can never leak one.
 */
export class RenderLimiter {
  private readonly maxConcurrent: number;
  private readonly queueWaitMs: number;
  private readonly timeoutMs: number;
  private readonly timer: () => number;
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(options: RenderLimiterOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_RENDERS);
    this.queueWaitMs = options.queueWaitMs ?? DEFAULT_QUEUE_WAIT_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
    this.timer = options.timer ?? (() => performance.now());
  }

  /** Renders currently holding a permit. */
  get inFlight(): number {
    return this.active;
  }

  /** Requests waiting for a permit. */
  get waiting(): number {
    return this.queue.length;
  }

  async run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<LimitedResult<T>> {
    const queuedAt = this.timer();
    await this.acquire();
    const queuedMs = Math.max(0, Math.round(this.timer() - queuedAt));
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new UnavailableError(RENDER_RETRY_AFTER_SECONDS, 'PDF rendering timed out');
          controller.abort(error);
          reject(error);
        }, this.timeoutMs);
      });
      const running = task(controller.signal);
      // A task that finishes after the timeout must not raise an unhandled rejection.
      running.catch(() => undefined);
      const value = await Promise.race([running, timedOut]);
      return { value, queuedMs };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(waiter.timer);
          resolve();
        },
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new UnavailableError(RENDER_RETRY_AFTER_SECONDS, 'Rendering capacity exhausted'));
        }, this.queueWaitMs),
      };
      this.queue.push(waiter);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    // The permit is handed over directly, so `active` stays unchanged.
    if (next) next.grant();
    else this.active -= 1;
  }
}
