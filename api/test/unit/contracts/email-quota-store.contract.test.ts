import { describeEmailQuotaStoreContract } from '../../../src/testing/contracts/index.js';
import { FakeEmailQuotaStore } from '../../../src/testing/fakes/index.js';

describeEmailQuotaStoreContract('FakeEmailQuotaStore', () => ({
  adapter: new FakeEmailQuotaStore(),
  cleanup: () => undefined,
}));
