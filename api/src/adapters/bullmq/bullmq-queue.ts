import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  Queue,
  UnrecoverableError,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
} from 'bullmq';
import {
  TransientQueueError,
  type Clock,
  type TaskQueue,
  type TaskRequest,
} from '../../ports/index.js';
import { assertValidTaskName } from '../../shared/email-task.js';
import { MAX_ATTEMPTS, backoffMs, type QueueLogger } from '../in-process/task-queue.js';
import type { TaskHandlerRegistry } from '../in-process/task-handlers.js';

export const QUEUE_NAME = 'tasks';
/** Finished jobs keep their ID (and so their name) reserved for this long, like Cloud Tasks. */
const RETAIN_SECONDS = 24 * 3600;
/** Cloud Tasks dispatch rate: 1 per second. */
export const RATE_LIMIT = { max: 1, duration: 1000 } as const;

export interface BullMqQueueOptions {
  /** Producer connection (fails fast when Redis is down). */
  connection: Redis;
  clock: Clock;
  prefix?: string;
}

/** `QUEUE_ADAPTER=bullmq` producer: de-duplicates by job ID, delays rescheduled tasks. */
export class BullMqQueue implements TaskQueue {
  readonly queue: Queue;

  constructor(private readonly options: BullMqQueueOptions) {
    this.queue = new Queue(QUEUE_NAME, {
      connection: options.connection,
      ...(options.prefix ? { prefix: options.prefix } : {}),
    });
    this.queue.on('error', () => undefined);
  }

  async enqueue(task: TaskRequest): Promise<{ created: boolean }> {
    if (
      !/^\/[A-Za-z0-9/_.-]*$/.test(task.handler) ||
      task.handler.includes('//') ||
      task.handler.split('/').includes('..')
    ) {
      throw new RangeError('handler must be an absolute internal path');
    }
    if (task.dedupe) assertValidTaskName(task.name);
    const jobId = task.dedupe ? task.name : `${task.name}-${randomUUID()}`;
    const delay = task.scheduleAt
      ? Math.max(0, task.scheduleAt.getTime() - this.options.clock.now().getTime())
      : 0;
    const opts: JobsOptions = {
      jobId,
      delay,
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'custom' },
      removeOnComplete: { age: RETAIN_SECONDS },
      removeOnFail: { age: RETAIN_SECONDS },
    };
    let marker: string | undefined;
    try {
      if (task.dedupe) {
        // A retained job reserves the name for a day; the short marker serialises concurrent
        // producers so exactly one of them reports `created: true`.
        if (await this.queue.getJob(jobId)) return { created: false };
        marker = this.queue.toKey(`enqueue-lock:${jobId}`);
        if ((await this.options.connection.set(marker, '1', 'EX', 60, 'NX')) === null)
          return { created: false };
      }
      await this.queue.add(task.handler, task.payload, opts);
      return { created: true };
    } catch {
      if (marker) await this.options.connection.del(marker).catch(() => undefined);
      // The driver error can quote the job data: report neither message nor payload.
      throw new TransientQueueError('BullMQ enqueue failed');
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export interface TaskWorkerOptions {
  connection: ConnectionOptions;
  handlers: TaskHandlerRegistry;
  logger: QueueLogger;
  prefix?: string;
}

/**
 * Worker loop: runs the registered transport-neutral handler (no HTTP). A throw means retry;
 * `job.attemptsMade` is the retry count the handler needs. `close()` waits for the active job.
 */
export class TaskWorker {
  private worker: Worker | undefined;

  constructor(private readonly options: TaskWorkerOptions) {}

  start(): void {
    if (this.worker) return;
    const { logger } = this.options;
    const worker = new Worker(QUEUE_NAME, (job) => this.process(job), {
      connection: this.options.connection,
      ...(this.options.prefix ? { prefix: this.options.prefix } : {}),
      concurrency: 1,
      limiter: RATE_LIMIT,
      settings: { backoffStrategy: (attemptsMade: number) => backoffMs(attemptsMade) },
    });
    worker.on('error', (err) => {
      logger.warn({ error: err.name }, 'queue worker error');
    });
    worker.on('failed', (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= MAX_ATTEMPTS || err instanceof UnrecoverableError;
      const fields = { task: job.id, attempt: job.attemptsMade, error: err.name };
      if (final) logger.error(fields, 'task failed permanently after the last attempt');
      else logger.warn(fields, 'task attempt failed; retrying');
    });
    this.worker = worker;
  }

  private async process(job: Job): Promise<void> {
    const handler = this.options.handlers.get(job.name);
    if (!handler) throw new UnrecoverableError('task handler is not registered');
    await handler(job.data, { retryCount: job.attemptsMade });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
