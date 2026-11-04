import { InProcessEventBus } from '../../../src/adapters/in-process/event-bus.js';
import { describeEventBusContract } from '../../../src/testing/contracts/index.js';
import { FakeEventBus } from '../../../src/testing/fakes/index.js';

describeEventBusContract('FakeEventBus', () => ({
  adapter: new FakeEventBus(),
  cleanup: () => undefined,
}));

describeEventBusContract('InProcessEventBus', () => ({
  adapter: new InProcessEventBus({ error: () => undefined }),
  cleanup: () => undefined,
}));
