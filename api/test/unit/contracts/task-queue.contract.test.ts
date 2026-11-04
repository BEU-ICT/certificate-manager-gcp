import { describeTaskQueueContract } from '../../../src/testing/contracts/index.js';
import { FakeTaskQueue } from '../../../src/testing/fakes/index.js';

describeTaskQueueContract('FakeTaskQueue (in-process)', () => {
  const queue = new FakeTaskQueue();
  return { adapter: queue, cleanup: () => undefined, pending: () => queue.tasks };
});
