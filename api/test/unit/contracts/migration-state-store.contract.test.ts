import { describeMigrationStateStoreContract } from '../../../src/testing/contracts/index.js';
import { FakeClock, FakeMigrationStateStore } from '../../../src/testing/fakes/index.js';

describeMigrationStateStoreContract('FakeMigrationStateStore', () => ({
  adapter: new FakeMigrationStateStore(new FakeClock()),
  cleanup: () => undefined,
}));
