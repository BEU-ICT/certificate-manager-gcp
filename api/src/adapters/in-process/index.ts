import type { QueuePorts } from '../../wiring.js';
import type { AdapterContext } from '../registry.js';
import { createLogger } from '../../http/logging/logger.js';
import { SystemClock } from '../system/clock.js';
import { InProcessScheduler } from './scheduler.js';
import { inProcessTaskHandlers } from './task-handlers.js';
import { InProcessQueue } from './task-queue.js';

/** `QUEUE_ADAPTER=in-process`. Handlers come from `inProcessTaskHandlers`. */
export function createQueuePorts({ config }: AdapterContext): QueuePorts {
  return {
    taskQueue: new InProcessQueue({
      handlers: inProcessTaskHandlers,
      clock: new SystemClock(),
      logger: createLogger({ level: config.logLevel, gcpProject: config.gcpProject }),
    }),
    scheduler: new InProcessScheduler(),
  };
}
