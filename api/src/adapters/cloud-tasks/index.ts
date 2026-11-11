import { CloudTasksClient } from '@google-cloud/tasks';
import type { QueuePorts } from '../../wiring.js';
import type { AdapterContext } from '../registry.js';
import { AdapterError } from '../registry.js';
import { InProcessScheduler } from '../in-process/scheduler.js';
import { CloudTasksQueue } from './cloud-tasks-queue.js';

/** `QUEUE_ADAPTER=cloud-tasks`. Credentials come from the runtime service account (ADC). */
export function createQueuePorts({ config }: AdapterContext): QueuePorts {
  const { queue, location, invokerServiceAccount } = config.tasks;
  if (!queue || !location || !invokerServiceAccount) {
    throw new AdapterError(
      'QUEUE_ADAPTER: cloud-tasks needs TASKS_QUEUE, TASKS_LOCATION and TASKS_INVOKER_SA',
    );
  }
  return {
    taskQueue: new CloudTasksQueue({
      client: new CloudTasksClient(),
      project: config.gcpProject,
      location,
      queue,
      serviceUrl: config.serviceUrl,
      invokerServiceAccount,
    }),
    // Recurring jobs are realised by Cloud Scheduler (infra); this registry only records definitions.
    scheduler: new InProcessScheduler(),
  };
}
