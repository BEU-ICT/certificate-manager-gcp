import { describe, it } from 'vitest';
import type { MigrationStateStore } from '../../ports/index.js';
import { clause, type AdapterHandle, type ContractFactory } from './types.js';

const PORT = 'MigrationStateStore';
const MARK = 'markApplied: Atomically claims id; true for exactly one concurrent caller';

export type MigrationStateStoreContractFactory = ContractFactory<MigrationStateStore>;

/** Executable form of the TSDoc on `MigrationStateStore` (src/ports/migration-state-store.ts). */
export function describeMigrationStateStoreContract(
  name: string,
  factory: MigrationStateStoreContractFactory,
): void {
  const test = (title: string, body: (store: MigrationStateStore) => Promise<void>) =>
    it(title, async () => {
      const handle: AdapterHandle<MigrationStateStore> = await factory();
      try {
        await body(handle.adapter);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`MigrationStateStore contract: ${name}`, () => {
    test('a fresh store has no markers', async (store) => {
      clause(PORT, 'isApplied: Whether a marker exists', 'fresh store')
        .that(await store.isApplied('001-first'))
        .toBe(false);
      clause(PORT, 'appliedIds: Ids of every marked migration', 'fresh store')
        .that([...(await store.appliedIds())])
        .toEqual([]);
    });

    test('markApplied claims once; the second claim loses', async (store) => {
      clause(PORT, MARK, 'first claim')
        .that(await store.markApplied('001-first', 'a'))
        .toBe(true);
      clause(PORT, MARK, 'second claim of the same id')
        .that(await store.markApplied('001-first', 'b'))
        .toBe(false);
      clause(PORT, 'isApplied: Whether a marker exists', 'after claim')
        .that(await store.isApplied('001-first'))
        .toBe(true);
    });

    test('a lost claim does not overwrite the winner', async (store) => {
      await store.markApplied('001-first', 'a');
      await store.markApplied('001-first', 'b');
      // `b` must not be able to release a marker it does not hold.
      await store.unmarkApplied('001-first', 'b');
      clause(PORT, 'markApplied: A marker that already exists is never overwritten', 'held by a')
        .that(await store.isApplied('001-first'))
        .toBe(true);
    });

    test('appliedIds lists every marked id, with hyphenated ids intact', async (store) => {
      await store.markApplied('001-first', 'a');
      await store.markApplied('002-second-step', 'a');
      clause(PORT, 'appliedIds: Ids of every marked migration', 'two markers')
        .that([...(await store.appliedIds())].sort())
        .toEqual(['001-first', '002-second-step']);
    });

    test('ids are independent', async (store) => {
      await store.markApplied('001-first', 'a');
      clause(PORT, MARK, 'claiming another id')
        .that(await store.markApplied('002-second', 'a'))
        .toBe(true);
    });

    test('unmarkApplied by the holder frees the id for a new claim', async (store) => {
      await store.markApplied('001-first', 'a');
      await store.markApplied('002-second', 'a');
      await store.unmarkApplied('001-first', 'a');
      clause(PORT, 'unmarkApplied: Removes the marker when held by by', 'holder releases')
        .that(await store.isApplied('001-first'))
        .toBe(false);
      clause(PORT, 'unmarkApplied: Other markers are untouched', 'second marker')
        .that(await store.isApplied('002-second'))
        .toBe(true);
      clause(PORT, MARK, 'claim after release')
        .that(await store.markApplied('001-first', 'b'))
        .toBe(true);
    });

    test('unmarkApplied of a missing marker succeeds', async (store) => {
      await clause(PORT, 'unmarkApplied: A missing marker counts as success', 'no marker').resolved(
        store.unmarkApplied('009-missing', 'a'),
      );
    });

    test('concurrent claims: exactly one winner', async (store) => {
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => store.markApplied('001-first', `instance-${i}`)),
      );
      clause(PORT, MARK, 'winners among 20 concurrent claims')
        .that(results.filter(Boolean))
        .toHaveLength(1);
    });
  });
}
