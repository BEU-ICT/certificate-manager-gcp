import { InProcessRateLimiter } from '../../../src/adapters/in-process/rate-limiter.js';
import { describeRateLimiterContract } from '../../../src/testing/contracts/index.js';
import { FakeClock, FakeRateLimiter } from '../../../src/testing/fakes/index.js';

describeRateLimiterContract('FakeRateLimiter', () => {
  const clock = new FakeClock();
  const adapter = new FakeRateLimiter(clock);
  return {
    adapter,
    clock,
    advance: (ms) => clock.advance(ms),
    cleanup: () => {
      adapter.close();
    },
  };
});

describeRateLimiterContract('InProcessRateLimiter', () => {
  const clock = new FakeClock();
  const adapter = new InProcessRateLimiter(clock);
  return {
    adapter,
    clock,
    advance: (ms) => clock.advance(ms),
    cleanup: () => {
      adapter.close();
    },
  };
});
