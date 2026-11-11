import {
  TransientQueueError,
  type Clock,
  type TaskQueue,
  type TaskRequest,
} from '../../ports/index.js';
import type { TaskHandlerRegistry } from './task-handlers.js';

/** Same policy as the Cloud Tasks queue (docs/email-queue.md). */
export const MAX_ATTEMPTS = 5;
const MIN_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 3_600_000;
const MAX_DOUBLINGS = 4;
/** setTimeout cannot wait longer; longer delays are split into several waits. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Delay before retry number `retry` (1 = after the first failure): doubles from 10 s for
 * `MAX_DOUBLINGS` doublings, then grows linearly by the last step, capped at 3600 s.
 */
export function backoffMs(retry: number): number {
  const i = retry - 1;
  const raw =
    i <= MAX_DOUBLINGS
      ? MIN_BACKOFF_MS * 2 ** i
      : MIN_BACKOFF_MS * 2 ** MAX_DOUBLINGS * (i - MAX_DOUBLINGS + 1);
  return Math.min(raw, MAX_BACKOFF_MS);
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Resolves the global functions at call time so fake timers installed later are honoured. */
const globalTimers: Timers = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Minimal logger surface; satisfied by pino and the Fastify logger. */
export interface QueueLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface InProcessQueueOptions {
  handlers: TaskHandlerRegistry;
  clock: Clock;
  logger: QueueLogger;
  timers?: Timers;
}

export interface InProcessTaskInfo {
  name: string;
  handler: string;
  scheduleAt?: Date | undefined;
  state: 'waiting' | 'succeeded' | 'failed';
  attempts: number;
}

interface Entry extends InProcessTaskInfo {
  payload: unknown;
  timer?: unknown;
}

/**
 * `QUEUE_ADAPTER=in-process`: runs handlers in this process (no HTTP, no OIDC) with the Cloud Tasks
 * retry policy. State is lost on restart, so it is for local development and single-node setups.
 * Logs carry the task name and handler path, never the payload.
 */
export class InProcessQueue implements TaskQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly timers: Timers;
  private anonymous = 0;
  private stopped = false;

  constructor(private readonly options: InProcessQueueOptions) {
    this.timers = options.timers ?? globalTimers;
  }

  enqueue(task: TaskRequest): Promise<{ created: boolean }> {
    if (this.stopped) return Promise.reject(new TransientQueueError('queue is stopped'));
    if (task.dedupe && this.entries.has(task.name)) return Promise.resolve({ created: false });
    const key = task.dedupe ? task.name : `${task.name}#${(this.anonymous += 1)}`;
    const entry: Entry = {
      name: task.name,
      handler: task.handler,
      scheduleAt: task.scheduleAt && new Date(task.scheduleAt.getTime()),
      payload: structuredClone(task.payload),
      state: 'waiting',
      attempts: 0,
    };
    this.entries.set(key, entry);
    this.waitUntil(entry, task.scheduleAt?.getTime() ?? this.options.clock.now().getTime());
    return Promise.resolve({ created: true });
  }

  /** Every accepted task, finished ones included (names stay reserved, like a real queue). */
  tasks(): InProcessTaskInfo[] {
    return [...this.entries.values()].map(({ name, handler, scheduleAt, state, attempts }) => ({
      name,
      handler,
      scheduleAt,
      state,
      attempts,
    }));
  }

  /** Cancels all timers; waiting tasks are dropped and nothing new is accepted. */
  stop(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) {
      if (entry.timer !== undefined) this.timers.clearTimeout(entry.timer);
    }
  }

  private waitUntil(entry: Entry, dueAtMs: number): void {
    const remaining = Math.max(0, dueAtMs - this.options.clock.now().getTime());
    entry.timer = this.timers.setTimeout(
      () => {
        entry.timer = undefined;
        if (this.stopped) return;
        if (remaining > MAX_TIMER_MS) this.waitUntil(entry, dueAtMs);
        else void this.run(entry);
      },
      Math.min(remaining, MAX_TIMER_MS),
    );
  }

  private async run(entry: Entry): Promise<void> {
    const handler = this.options.handlers.get(entry.handler);
    if (!handler) {
      // Retrying cannot help: the path is not registered in this process.
      entry.state = 'failed';
      this.options.logger.error(
        { task: entry.name, handler: entry.handler },
        'task handler is not registered; task dropped',
      );
      return;
    }
    entry.attempts += 1;
    try {
      await handler(structuredClone(entry.payload));
      entry.state = 'succeeded';
    } catch (err) {
      const fields = { task: entry.name, attempt: entry.attempts, error: describe(err) };
      if (entry.attempts >= MAX_ATTEMPTS) {
        entry.state = 'failed';
        this.options.logger.error(fields, 'task failed permanently after the last attempt');
        return;
      }
      const delay = backoffMs(entry.attempts);
      this.options.logger.warn({ ...fields, retryInMs: delay }, 'task attempt failed; retrying');
      this.waitUntil(entry, this.options.clock.now().getTime() + delay);
    }
  }
}

/** Error name only: messages of handlers may quote personal data. */
function describe(err: unknown): string {
  return err instanceof Error ? err.name : 'non-error thrown';
}
