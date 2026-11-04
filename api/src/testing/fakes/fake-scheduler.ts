import type { ScheduledJob, Scheduler } from '../../ports/index.js';

/** Records registered jobs; nothing runs. Registering the same name replaces the definition. */
export class FakeScheduler implements Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();

  register(job: ScheduledJob): Promise<void> {
    this.jobs.set(job.name, { ...job });
    return Promise.resolve();
  }

  list(): Promise<ScheduledJob[]> {
    return Promise.resolve([...this.jobs.values()].map((job) => ({ ...job })));
  }
}
