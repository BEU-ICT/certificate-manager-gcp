import type { QueuePorts } from '../../wiring.js';
import type { AdapterContext } from '../registry.js';
import { AdapterError } from '../registry.js';
import { createLogger } from '../../http/logging/logger.js';
import { createRedis } from '../redis/connection.js';
import { InProcessScheduler } from '../in-process/scheduler.js';
import { inProcessTaskHandlers } from '../in-process/task-handlers.js';
import { SystemClock } from '../system/clock.js';
import { BullMqQueue, TaskWorker } from './bullmq-queue.js';

/**
 * `QUEUE_ADAPTER=bullmq`. Handlers come from `inProcessTaskHandlers` (the same transport-neutral
 * functions the HTTP route calls). The worker runs here unless `WORKER_ENABLED=false`.
 */
export function createQueuePorts({ config }: AdapterContext): QueuePorts {
  if (!config.redis.url) throw new AdapterError('QUEUE_ADAPTER: bullmq needs REDIS_URL');
  const url = config.redis.url;
  const logger = createLogger({ level: config.logLevel, gcpProject: config.gcpProject });
  const producerRedis = createRedis(url, { maxRetriesPerRequest: 2 });
  const queue = new BullMqQueue({ connection: producerRedis, clock: new SystemClock() });
  const workerRedis = config.workerEnabled
    ? createRedis(url, { maxRetriesPerRequest: null })
    : undefined;
  const worker = workerRedis
    ? new TaskWorker({ connection: workerRedis, handlers: inProcessTaskHandlers, logger })
    : undefined;
  return {
    taskQueue: queue,
    scheduler: new InProcessScheduler(),
    start: () => worker?.start(),
    close: async () => {
      await worker?.close(); // drains the active job
      await queue.close();
      producerRedis.disconnect();
      workerRedis?.disconnect();
    },
  };
}
