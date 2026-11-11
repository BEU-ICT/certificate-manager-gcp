import type { ScheduledJob, Scheduler } from '../../ports/index.js';

/** Keeps job definitions in memory; a cron-capable runtime (Cloud Scheduler) triggers the runs. */
export class InProcessScheduler implements Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();

  register(job: ScheduledJob): Promise<void> {
    this.jobs.set(job.name, { ...job });
    return Promise.resolve();
  }

  list(): Promise<ScheduledJob[]> {
    return Promise.resolve([...this.jobs.values()].map((job) => ({ ...job })));
  }
}
