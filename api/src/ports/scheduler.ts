export interface ScheduledJob {
  /** Unique job name. */
  name: string;
  /** Cron expression (5 fields, UTC). */
  schedule: string;
  /** Internal HTTP path executed on each run. */
  handler: string;
}

/** Registry of recurring jobs, realised by a cron-capable runtime. */
export interface Scheduler {
  /** Idempotent by `name`: registering again replaces the definition. */
  register(job: ScheduledJob): Promise<void>;
  list(): Promise<ScheduledJob[]>;
}
