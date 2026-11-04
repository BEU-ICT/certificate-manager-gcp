import { describe, it } from 'vitest';
import type { TaskQueue, TaskRequest } from '../../ports/index.js';
import { clause, type AdapterHandle } from './types.js';

const PORT = 'TaskQueue';
const DEDUPE =
  'enqueue: With dedupe: true an existing task of the same name yields created: false (not an error) and nothing is enqueued';
const SCHEDULE = 'TaskRequest.scheduleAt: Earliest execution time; immediately when omitted';

/**
 * A task as the backing store holds it. Adapters that can list pending work (fakes, SQL) expose it
 * through `pending` so the suite can check scheduling; queues that cannot (Cloud Tasks) omit it and
 * only the observable `enqueue` results are checked.
 */
export interface PendingTask {
  name: string;
  scheduleAt?: Date | undefined;
}

export interface TaskQueueHandle extends AdapterHandle<TaskQueue> {
  pending?: () => Promise<PendingTask[]> | PendingTask[];
}

export type TaskQueueContractFactory = () => Promise<TaskQueueHandle> | TaskQueueHandle;

const base = new Date('2030-01-01T00:00:00.000Z');
const at = (offsetMs: number) => new Date(base.getTime() + offsetMs);

function task(name: string, overrides: Partial<TaskRequest> = {}): TaskRequest {
  return { name, handler: '/internal/tasks/test', payload: { name }, dedupe: true, ...overrides };
}

/** Executable form of the TSDoc on `TaskQueue` (src/ports/task-queue.ts). */
export function describeTaskQueueContract(name: string, factory: TaskQueueContractFactory): void {
  const test = (title: string, body: (handle: TaskQueueHandle) => Promise<void>) =>
    it(title, async () => {
      const handle = await factory();
      try {
        await body(handle);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`TaskQueue contract: ${name}`, () => {
    test('a new task is created', async ({ adapter }) => {
      clause(PORT, 'enqueue: yields created: true for a new task', 'first enqueue')
        .that(await adapter.enqueue(task('t1')))
        .toEqual({ created: true });
    });

    test('dedupe: true with an existing name yields created: false and enqueues nothing', async ({
      adapter,
      pending,
    }) => {
      await adapter.enqueue(task('same'));
      await clause(PORT, DEDUPE, 'second enqueue must resolve, not reject').resolvedTo(
        adapter.enqueue(task('same')),
        { created: false },
      );
      if (pending) {
        const names = (await pending()).map((t) => t.name);
        clause(PORT, DEDUPE, `pending task names: [${names.join(', ')}]`)
          .that(names.filter((n) => n === 'same'))
          .toHaveLength(1);
      }
    });

    test('dedupe applies per name only', async ({ adapter }) => {
      await adapter.enqueue(task('one'));
      clause(PORT, DEDUPE, 'a different name is not a duplicate')
        .that(await adapter.enqueue(task('two')))
        .toEqual({ created: true });
    });

    test('concurrent enqueues of one name create exactly one task', async ({ adapter }) => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => adapter.enqueue(task('race'))),
      );
      clause(PORT, DEDUPE, 'concurrent callers with created: true')
        .that(results.filter((r) => r.created))
        .toHaveLength(1);
    });

    test('dedupe: false never de-duplicates', async ({ adapter }) => {
      await adapter.enqueue(task('repeat', { dedupe: false }));
      clause(
        PORT,
        'TaskRequest.dedupe: de-duplication happens only when dedupe is true',
        'dedupe:false',
      )
        .that(await adapter.enqueue(task('repeat', { dedupe: false })))
        .toEqual({ created: true });
    });

    test('scheduleAt is the earliest execution time and is kept per task', async ({
      adapter,
      pending,
    }) => {
      clause(PORT, SCHEDULE, 'scheduled task is accepted')
        .that(await adapter.enqueue(task('late', { scheduleAt: at(60_000) })))
        .toEqual({ created: true });
      clause(PORT, SCHEDULE, 'task without scheduleAt is accepted')
        .that(await adapter.enqueue(task('now')))
        .toEqual({ created: true });
      clause(PORT, SCHEDULE, 'earlier schedule enqueued after a later one is accepted')
        .that(await adapter.enqueue(task('early', { scheduleAt: at(1_000) })))
        .toEqual({ created: true });
      if (pending) {
        const byName = new Map((await pending()).map((t) => [t.name, t.scheduleAt]));
        clause(PORT, SCHEDULE, 'late task keeps its own time')
          .that(byName.get('late')?.getTime())
          .toBe(at(60_000).getTime());
        clause(PORT, SCHEDULE, 'early task keeps its own time, not the later one')
          .that(byName.get('early')?.getTime())
          .toBe(at(1_000).getTime());
        const omitted = byName.get('now');
        clause(PORT, SCHEDULE, 'omitted scheduleAt means immediately (never in the future)')
          .that(omitted === undefined || omitted.getTime() <= Date.now() + 1_000)
          .toBe(true);
      }
    });

    test('a duplicate keeps the original scheduleAt', async ({ adapter, pending }) => {
      await adapter.enqueue(task('keep', { scheduleAt: at(5_000) }));
      await adapter.enqueue(task('keep', { scheduleAt: at(90_000) }));
      if (pending) {
        const found = (await pending()).filter((t) => t.name === 'keep');
        clause(PORT, DEDUPE, 'nothing is enqueued, so the first schedule stays')
          .that(found.map((t) => t.scheduleAt?.getTime()))
          .toEqual([at(5_000).getTime()]);
      }
    });
  });
}
