export interface TaskRequest {
  /** Unique, deterministic task name, used for de-duplication when `dedupe` is true. */
  name: string;
  /** Internal HTTP path that executes the task, e.g. `/internal/tasks/send-email`. */
  handler: string;
  /** JSON-serialisable; must not contain personal data beyond IDs. */
  payload: unknown;
  /** Earliest execution time; immediately when omitted. */
  scheduleAt?: Date;
  dedupe: boolean;
}

/**
 * Deferred, at-least-once execution of internal handlers. Handlers must be idempotent.
 */
export interface TaskQueue {
  /**
   * With `dedupe: true` an existing task of the same name yields
   * `created: false` (not an error) and nothing is enqueued.
   */
  enqueue(task: TaskRequest): Promise<{ created: boolean }>;
}
