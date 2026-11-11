import { InProcessQueue } from '../../../src/adapters/in-process/task-queue.js';
import { SystemClock } from '../../../src/adapters/system/clock.js';
import { describeTaskQueueContract } from '../../../src/testing/contracts/index.js';
import { FakeTaskQueue } from '../../../src/testing/fakes/index.js';

describeTaskQueueContract('FakeTaskQueue (in-process)', () => {
  const queue = new FakeTaskQueue();
  return { adapter: queue, cleanup: () => undefined, pending: () => queue.tasks };
});

describeTaskQueueContract('InProcessQueue', () => {
  const queue = new InProcessQueue({
    handlers: new Map([['/internal/tasks/test', () => Promise.resolve()]]),
    clock: new SystemClock(),
    logger: { warn: () => undefined, error: () => undefined },
  });
  return { adapter: queue, cleanup: () => queue.stop(), pending: () => queue.tasks() };
});
