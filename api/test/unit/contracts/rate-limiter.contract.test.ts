import { InProcessRateLimiter } from '../../../src/adapters/in-process/rate-limiter.js';
import { describeRateLimiterContract } from '../../../src/testing/contracts/index.js';
import { FakeClock, FakeRateLimiter } from '../../../src/testing/fakes/index.js';

describeRateLimiterContract('FakeRateLimiter', () => {
  const clock = new FakeClock();
  return {
    adapter: new FakeRateLimiter(clock),
    clock,
    advance: (ms) => clock.advance(ms),
    cleanup: () => undefined,
  };
});

describeRateLimiterContract('InProcessRateLimiter', () => {
  const clock = new FakeClock();
  return {
    adapter: new InProcessRateLimiter(clock),
    clock,
    advance: (ms) => clock.advance(ms),
    cleanup: () => undefined,
  };
});
