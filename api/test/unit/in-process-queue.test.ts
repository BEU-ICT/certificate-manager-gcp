import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InProcessQueue, backoffMs } from '../../src/adapters/in-process/task-queue.js';
import { createQueuePorts } from '../../src/adapters/in-process/index.js';
import { inProcessTaskHandlers } from '../../src/adapters/in-process/task-handlers.js';
import { defaultRegistries } from '../../src/compose.js';
import { TransientQueueError, type Clock, type TaskRequest } from '../../src/ports/index.js';

const clock: Clock = { now: () => new Date() };

function setup(fn: (payload: unknown) => Promise<void>) {
  const logger = { warn: vi.fn(), error: vi.fn() };
  const handler = vi.fn(fn);
  const queue = new InProcessQueue({
    handlers: new Map([['/internal/tasks/h', handler]]),
    clock,
    logger,
  });
  return { queue, handler, logger };
}

const task = (over: Partial<TaskRequest> = {}): TaskRequest => ({
  name: 't',
  handler: '/internal/tasks/h',
  payload: { id: 'x' },
  dedupe: true,
  ...over,
});

describe('backoffMs', () => {
  it('doubles from 10 s, then grows linearly, capped at 3600 s', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([
      10_000, 20_000, 40_000, 80_000, 160_000, 320_000,
    ]);
    expect(backoffMs(100)).toBe(3_600_000);
  });
});

describe('InProcessQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the handler with a copy of the payload, without delay when scheduleAt is omitted', async () => {
    const { queue, handler } = setup(() => Promise.resolve());
    await queue.enqueue(task());
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledExactlyOnceWith({ id: 'x' });
    expect(queue.tasks()[0]?.state).toBe('succeeded');
  });

  it('honours scheduleAt', async () => {
    const { queue, handler } = setup(() => Promise.resolve());
    await queue.enqueue(task({ scheduleAt: new Date(Date.now() + 60_000) }));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('waits in several steps for schedules beyond the timer limit', async () => {
    const { queue, handler } = setup(() => Promise.resolve());
    await queue.enqueue(task({ scheduleAt: new Date(Date.now() + 40 * 86_400_000) }));
    await vi.advanceTimersByTimeAsync(39 * 86_400_000);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries with exponential backoff and gives up after 5 attempts', async () => {
    const { queue, handler, logger } = setup(() =>
      Promise.reject(new Error('mail to a@b.c failed')),
    );
    await queue.enqueue(task());
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1);
    for (const [wait, calls] of [
      [10_000, 2],
      [20_000, 3],
      [40_000, 4],
      [80_000, 5],
    ] as const) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(handler).toHaveBeenCalledTimes(calls - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(handler).toHaveBeenCalledTimes(calls);
    }
    await vi.advanceTimersByTimeAsync(10_000_000);
    expect(handler).toHaveBeenCalledTimes(5);
    expect(queue.tasks()[0]).toMatchObject({ state: 'failed', attempts: 5 });
    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...logger.warn.mock.calls, ...logger.error.mock.calls])).not.toContain(
      'a@b.c',
    );
  });

  it('succeeds on a later attempt', async () => {
    let calls = 0;
    const { queue, handler } = setup(() =>
      ++calls < 3 ? Promise.reject(new Error('x')) : Promise.resolve(),
    );
    await queue.enqueue(task());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(queue.tasks()[0]?.state).toBe('succeeded');
  });

  it('dedupes by name, also after completion', async () => {
    const { queue, handler } = setup(() => Promise.resolve());
    await expect(queue.enqueue(task())).resolves.toEqual({ created: true });
    await vi.advanceTimersByTimeAsync(0);
    await expect(queue.enqueue(task())).resolves.toEqual({ created: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('treats an unknown handler path as a permanent failure and logs it', async () => {
    const { queue, logger } = setup(() => Promise.resolve());
    await queue.enqueue(task({ handler: '/internal/tasks/unknown' }));
    await vi.advanceTimersByTimeAsync(10_000_000);
    expect(queue.tasks()[0]).toMatchObject({ state: 'failed', attempts: 0 });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stop() drops waiting tasks and refuses new ones', async () => {
    const { queue, handler } = setup(() => Promise.resolve());
    await queue.enqueue(task({ scheduleAt: new Date(Date.now() + 1000) }));
    queue.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(handler).not.toHaveBeenCalled();
    await expect(queue.enqueue(task({ name: 'other' }))).rejects.toBeInstanceOf(
      TransientQueueError,
    );
  });
});

describe('QUEUE_ADAPTER=in-process wiring', () => {
  it('is registered and runs handlers from the shared registry', async () => {
    const registries = defaultRegistries();
    expect(registries.queue.has('in-process')).toBe(true);
    expect(registries.queue.has('cloud-tasks')).toBe(true);

    const fn = vi.fn(() => Promise.resolve());
    inProcessTaskHandlers.set('/internal/tasks/wired', fn);
    try {
      const ports = createQueuePorts({
        config: { logLevel: 'silent', gcpProject: 'demo' },
      } as unknown as Parameters<typeof createQueuePorts>[0]);
      await ports.taskQueue.enqueue({
        name: 'wired-1',
        handler: '/internal/tasks/wired',
        payload: {},
        dedupe: true,
      });
      await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
      await ports.scheduler.register({ name: 'j', schedule: '* * * * *', handler: '/internal/j' });
      expect(await ports.scheduler.list()).toHaveLength(1);
    } finally {
      inProcessTaskHandlers.delete('/internal/tasks/wired');
    }
  });
});
