import { describeIdempotencyStoreContract } from '../../../src/testing/contracts/index.js';
import { FakeClock, FakeIdempotencyStore } from '../../../src/testing/fakes/index.js';

describeIdempotencyStoreContract('FakeIdempotencyStore', () => {
  const clock = new FakeClock();
  return {
    adapter: new FakeIdempotencyStore(clock),
    advance: (ms) => clock.advance(ms),
    cleanup: () => undefined,
  };
});
