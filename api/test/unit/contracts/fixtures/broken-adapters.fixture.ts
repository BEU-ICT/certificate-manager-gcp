/**
 * Deliberately broken adapters, run through the real contract suites by
 * `harness.test.ts` in a nested Vitest run. This file is NOT matched by the normal `include`
 * (it does not end in `.test.ts`), so it never leaves a failing test in the regular run.
 */
import type {
  RateLimit,
  RateLimiter,
  RateLimitResult,
  TaskQueue,
  TaskRequest,
} from '../../../../src/ports/index.js';
import {
  describeEventBusContract,
  describeRateLimiterContract,
  describeStorageGatewayContract,
  describeTaskQueueContract,
} from '../../../../src/testing/contracts/index.js';
import {
  FakeClock,
  FakeEventBus,
  FakeStorageGateway,
} from '../../../../src/testing/fakes/index.js';
import type { BucketKind, PutOptions } from '../../../../src/ports/index.js';

/** `putIfAbsent` is check-then-write across an await: concurrent callers all "create". */
class RacyStorage extends FakeStorageGateway {
  override async putIfAbsent(
    kind: BucketKind,
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<{ created: boolean }> {
    const exists = (await this.get(kind, key)) !== null;
    await Promise.resolve();
    if (exists) return { created: false };
    await this.put(kind, key, body, options);
    return { created: true };
  }
}

/** Ignores `dedupe`. */
class NonDedupingQueue implements TaskQueue {
  readonly tasks: TaskRequest[] = [];
  enqueue(task: TaskRequest): Promise<{ created: boolean }> {
    this.tasks.push(task);
    return Promise.resolve({ created: true });
  }
}

/** Never denies. */
class UnlimitedRateLimiter implements RateLimiter {
  constructor(private readonly clock: FakeClock) {}
  consume(_key: string, { limit, windowMs }: RateLimit): Promise<RateLimitResult> {
    return Promise.resolve({
      allowed: true,
      remaining: limit,
      resetAt: new Date(this.clock.now().getTime() + windowMs),
    });
  }
}

/** Lets a failing subscriber reject `publish`. */
class FragileEventBus extends FakeEventBus {
  override async publish(...args: Parameters<FakeEventBus['publish']>): Promise<void> {
    await super.publish(...args);
    const failure = this.errors[0];
    if (failure) throw failure.error;
  }
}

describeStorageGatewayContract('BROKEN racy putIfAbsent', () => ({
  adapter: new RacyStorage(),
  cleanup: () => undefined,
}));

describeTaskQueueContract('BROKEN ignores dedupe', () => {
  const queue = new NonDedupingQueue();
  return { adapter: queue, cleanup: () => undefined, pending: () => queue.tasks };
});

describeRateLimiterContract('BROKEN never limits', () => {
  const clock = new FakeClock();
  return {
    adapter: new UnlimitedRateLimiter(clock),
    clock,
    advance: (ms) => clock.advance(ms),
    cleanup: () => undefined,
  };
});

describeEventBusContract('BROKEN publish rejects', () => ({
  adapter: new FragileEventBus(),
  cleanup: () => undefined,
}));
