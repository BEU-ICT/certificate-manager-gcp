import type { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreMigrationStateStore } from '../../src/adapters/firestore/migration-state-store.js';
import { runMigrations, type Migration } from '../../src/migrations/index.js';
import { describeMigrationStateStoreContract } from '../../src/testing/contracts/index.js';
import { createFakes, FakeClock } from '../../src/testing/fakes/index.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

const db = getTestFirestore();

// The shared contract, against the emulator (each case starts from an empty database).
describeMigrationStateStoreContract('FirestoreMigrationStateStore (emulator)', async () => {
  await resetFirestore();
  return {
    adapter: new FirestoreMigrationStateStore(db, new FakeClock()),
    cleanup: () => undefined,
  };
});

describe('FirestoreMigrationStateStore', () => {
  beforeEach(resetFirestore);

  it('stores markers at system/migrations as applied.<id> = { at, by }', async () => {
    const clock = new FakeClock();
    const store = new FirestoreMigrationStateStore(db, clock);

    await store.markApplied('001-first', 'rev-1');

    const data = (await db.collection('system').doc('migrations').get()).data();
    expect(data?.['schemaVersion']).toBe(1);
    const marker = (data?.['applied'] as Record<string, { by: string; at: Timestamp }>)[
      '001-first'
    ];
    expect(marker?.by).toBe('rev-1');
    expect(marker?.at.toDate()).toEqual(clock.now());
  });

  it('runs the body once for two concurrent runners', async () => {
    const fakes = createFakes();
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const list: Migration[] = [{ id: '001-first', description: 'test', run }];
    const context = {
      clock: fakes.clock,
      organizations: fakes.organizations,
      events: fakes.events,
      templates: fakes.templates,
      certificates: fakes.certificates,
      emailSender: fakes.emailSender,
      log: { info: vi.fn(), error: vi.fn() },
    };
    const start = (instanceId: string) =>
      runMigrations({
        store: new FirestoreMigrationStateStore(db, fakes.clock),
        context,
        instanceId,
        migrations: list,
      });

    const [a, b] = await Promise.all([start('a'), start('b')]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(a.applied.length + b.applied.length).toBe(1);
    expect(a.skipped.length + b.skipped.length).toBe(1);
  });
});
