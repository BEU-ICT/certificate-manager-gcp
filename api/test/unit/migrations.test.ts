import { describe, expect, it, vi } from 'vitest';
import { MigrationError, runMigrations, type Migration } from '../../src/migrations/index.js';
import { createFakes } from '../../src/testing/fakes/index.js';

const silent = { info: vi.fn(), error: vi.fn() };

function setup() {
  const fakes = createFakes();
  const context = {
    clock: fakes.clock,
    organizations: fakes.organizations,
    events: fakes.events,
    templates: fakes.templates,
    certificates: fakes.certificates,
    emailSender: fakes.emailSender,
    log: silent,
  };
  const store = fakes.migrationState;
  return { fakes, context, store };
}

function migration(id: string, run: Migration['run'] = () => Promise.resolve()): Migration {
  return { id, description: `migration ${id}`, run };
}

describe('runMigrations', () => {
  it('runs pending migrations in id order and marks each one', async () => {
    const { context, store, fakes } = setup();
    const order: string[] = [];
    const list = ['001-a', '002-b', '010-c'].map((id) =>
      migration(id, () => {
        order.push(id);
        return Promise.resolve();
      }),
    );

    const report = await runMigrations({ store, context, instanceId: 'i1', migrations: list });

    expect(order).toEqual(['001-a', '002-b', '010-c']);
    expect(report.applied).toEqual(order);
    expect(store.marker('002-b')).toEqual({ at: fakes.clock.now(), by: 'i1' });
  });

  it('does nothing and reads the markers once when everything is applied', async () => {
    const { context, store } = setup();
    const run = vi.fn(() => Promise.resolve());
    const list = [migration('001-a', run), migration('002-b', run)];
    await runMigrations({ store, context, instanceId: 'i1', migrations: list });
    run.mockClear();
    store.reads = 0;

    const report = await runMigrations({ store, context, instanceId: 'i2', migrations: list });

    expect(run).not.toHaveBeenCalled();
    expect(report).toEqual({ applied: [], skipped: ['001-a', '002-b'] });
    expect(store.reads).toBe(1);
  });

  it('runs only the migrations that are not marked yet', async () => {
    const { context, store } = setup();
    await store.markApplied('001-a', 'earlier');
    const run = vi.fn(() => Promise.resolve());

    const report = await runMigrations({
      store,
      context,
      instanceId: 'i1',
      migrations: [migration('001-a', run), migration('002-b', run)],
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(report.applied).toEqual(['002-b']);
  });

  it('stops at the first failure, releases its marker and keeps earlier ones', async () => {
    const { context, store } = setup();
    const later = vi.fn(() => Promise.resolve());
    const list = [
      migration('001-a'),
      migration('002-b', () => Promise.reject(new Error('boom'))),
      migration('003-c', later),
    ];

    const failure = await runMigrations({
      store,
      context,
      instanceId: 'i1',
      migrations: list,
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(MigrationError);
    expect((failure as MigrationError).migrationId).toBe('002-b');
    expect((failure as MigrationError).cause).toEqual(new Error('boom'));
    expect(later).not.toHaveBeenCalled();
    expect(await store.isApplied('001-a')).toBe(true);
    expect(await store.isApplied('002-b')).toBe(false);
  });

  it('retries a failed migration on the next start', async () => {
    const { context, store } = setup();
    let attempts = 0;
    const flaky = migration('001-a', () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('first start fails')) : Promise.resolve();
    });

    await expect(
      runMigrations({ store, context, instanceId: 'i1', migrations: [flaky] }),
    ).rejects.toBeInstanceOf(MigrationError);
    const second = await runMigrations({
      store,
      context,
      instanceId: 'i2',
      migrations: [flaky],
    });

    expect(attempts).toBe(2);
    expect(second.applied).toEqual(['001-a']);
    expect(store.marker('001-a')?.by).toBe('i2');
  });

  it('still fails with the migration error when releasing the marker fails', async () => {
    const { context, store } = setup();
    vi.spyOn(store, 'unmarkApplied').mockRejectedValueOnce(new Error('store down'));

    await expect(
      runMigrations({
        store,
        context,
        instanceId: 'i1',
        migrations: [migration('001-a', () => Promise.reject(new Error('boom')))],
      }),
    ).rejects.toMatchObject({ name: 'MigrationError', migrationId: '001-a' });
  });

  it('runs the body once when two runners start together', async () => {
    const { context, store } = setup();
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const list = [migration('001-a', run), migration('002-b', run)];

    const [a, b] = await Promise.all([
      runMigrations({ store, context, instanceId: 'a', migrations: list }),
      runMigrations({ store, context, instanceId: 'b', migrations: list }),
    ]);

    expect(run).toHaveBeenCalledTimes(2);
    expect([...a.applied, ...b.applied].sort()).toEqual(['001-a', '002-b']);
    expect([...a.skipped, ...b.skipped].sort()).toEqual(['001-a', '002-b']);
  });

  it.each([
    ['a malformed id', [migration('1-a')], /Invalid migration id/],
    ['a duplicate id', [migration('001-a'), migration('001-a')], /Duplicate/],
    ['an out-of-order list', [migration('002-b'), migration('001-a')], /out of order/],
  ])('rejects %s before running anything', async (_name, list, message) => {
    const { context, store } = setup();
    await expect(
      runMigrations({ store, context, instanceId: 'i1', migrations: list }),
    ).rejects.toThrow(message);
    expect(store.reads).toBe(0);
  });

  it('has no registered migration yet, so the default list is a no-op', async () => {
    const { context, store } = setup();
    expect(await runMigrations({ store, context, instanceId: 'i1' })).toEqual({
      applied: [],
      skipped: [],
    });
  });
});
