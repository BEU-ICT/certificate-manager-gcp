import { describeEventRepositoryContract } from '../../../src/testing/contracts/index.js';
import { FakeEventRepository } from '../../../src/testing/fakes/index.js';

describeEventRepositoryContract('FakeEventRepository', () => ({
  adapter: new FakeEventRepository(),
  cleanup: () => undefined,
}));
