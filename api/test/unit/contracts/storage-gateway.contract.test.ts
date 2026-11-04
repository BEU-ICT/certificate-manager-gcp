import { describeStorageGatewayContract } from '../../../src/testing/contracts/index.js';
import { FakeStorageGateway } from '../../../src/testing/fakes/index.js';

describeStorageGatewayContract('FakeStorageGateway (memory)', () => ({
  adapter: new FakeStorageGateway(),
  cleanup: () => undefined,
}));
