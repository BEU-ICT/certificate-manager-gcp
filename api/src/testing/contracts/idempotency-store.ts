import { describe, it } from 'vitest';
import {
  IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS,
  IDEMPOTENCY_TTL_MS,
  type IdempotencyBegin,
  type IdempotencyScope,
  type IdempotencyStore,
} from '../../ports/index.js';
import { clause, type AdapterHandle } from './types.js';

const PORT = 'IdempotencyStore';
const BEGIN =
  'begin: exactly one caller gets started; same hash + completed gives replay; same hash + in_progress gives in_progress; a different hash gives mismatch';
const EXPIRY =
  'begin: a record that expired, or has been in_progress for 2 minutes, counts as absent';
const COMPLETE = 'complete: Marks an in_progress key completed with the response to replay';
const RELEASE = 'release: Deletes the key when it is still in_progress';

/** The store reads time through a clock the suite can move (a fake clock handed to the adapter). */
export interface IdempotencyStoreHandle extends AdapterHandle<IdempotencyStore> {
  advance: (ms: number) => Promise<void> | void;
}

export type IdempotencyStoreContractFactory = () =>
  Promise<IdempotencyStoreHandle> | IdempotencyStoreHandle;

const scope: IdempotencyScope = { adminUid: 'admin-1', key: 'key-1' };
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const RESPONSE = { status: 201, body: { id: 'cert-1' } };

/** `begin` outcomes without the random attempt id, for equality checks. */
const shape = (result: IdempotencyBegin) =>
  result.outcome === 'started' ? { outcome: result.outcome } : result;

async function start(adapter: IdempotencyStore, hash: string, who = scope): Promise<string> {
  const result = await adapter.begin(who, hash);
  if (result.outcome !== 'started') throw new Error(`expected started, got ${result.outcome}`);
  return result.attemptId;
}

/** Executable form of the TSDoc on `IdempotencyStore` (src/ports/idempotency-store.ts). */
export function describeIdempotencyStoreContract(
  name: string,
  factory: IdempotencyStoreContractFactory,
): void {
  const test = (title: string, body: (handle: IdempotencyStoreHandle) => Promise<void>) =>
    it(title, async () => {
      const handle = await factory();
      try {
        await body(handle);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`IdempotencyStore contract: ${name}`, () => {
    test('the first begin starts; the same request meanwhile is in_progress', async ({
      adapter,
    }) => {
      clause(PORT, BEGIN, 'first begin')
        .that(shape(await adapter.begin(scope, HASH_A)))
        .toEqual({ outcome: 'started' });
      clause(PORT, BEGIN, 'same hash while in progress')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'in_progress' });
    });

    test('a different hash is a mismatch, also while in progress', async ({ adapter }) => {
      await adapter.begin(scope, HASH_A);
      clause(PORT, BEGIN, 'different hash')
        .that(await adapter.begin(scope, HASH_B))
        .toEqual({ outcome: 'mismatch' });
    });

    test('a completed key replays the stored response; a different hash still mismatches', async ({
      adapter,
    }) => {
      const attemptId = await start(adapter, HASH_A);
      await adapter.complete(scope, attemptId, RESPONSE);
      clause(PORT, BEGIN, 'same hash after complete')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'replay', response: RESPONSE });
      clause(PORT, BEGIN, 'replay is repeatable')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'replay', response: RESPONSE });
      clause(PORT, BEGIN, 'different hash after complete')
        .that(await adapter.begin(scope, HASH_B))
        .toEqual({ outcome: 'mismatch' });
    });

    test('keys are scoped per administrator and per key', async ({ adapter }) => {
      await adapter.begin(scope, HASH_A);
      clause(PORT, BEGIN, 'other admin, same key')
        .that(shape(await adapter.begin({ adminUid: 'admin-2', key: 'key-1' }, HASH_A)))
        .toEqual({ outcome: 'started' });
      clause(PORT, BEGIN, 'same admin, other key')
        .that(shape(await adapter.begin({ adminUid: 'admin-1', key: 'key-2' }, HASH_A)))
        .toEqual({ outcome: 'started' });
    });

    test('concurrent begins: exactly one starts', async ({ adapter }) => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => adapter.begin(scope, HASH_A)),
      );
      clause(PORT, BEGIN, 'starters among 10 concurrent begins')
        .that(results.filter((r) => r.outcome === 'started'))
        .toHaveLength(1);
      clause(PORT, BEGIN, 'the others')
        .that(results.filter((r) => r.outcome === 'in_progress'))
        .toHaveLength(9);
    });

    test('release frees an in_progress key for a new begin, even with another hash', async ({
      adapter,
    }) => {
      const attemptId = await start(adapter, HASH_A);
      await adapter.release(scope, attemptId);
      clause(PORT, RELEASE, 'begin after release')
        .that(shape(await adapter.begin(scope, HASH_B)))
        .toEqual({ outcome: 'started' });
    });

    test('release leaves a completed key alone and a missing key is fine', async ({ adapter }) => {
      await clause(PORT, RELEASE, 'missing key').resolved(
        adapter.release(scope, 'no-such-attempt'),
      );
      const attemptId = await start(adapter, HASH_A);
      await adapter.complete(scope, attemptId, RESPONSE);
      await adapter.release(scope, attemptId);
      clause(PORT, RELEASE, 'completed key survives release')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'replay', response: RESPONSE });
    });

    test('complete on a missing key stores nothing', async ({ adapter }) => {
      await clause(PORT, COMPLETE, 'missing key').resolved(
        adapter.complete(scope, 'no-such-attempt', RESPONSE),
      );
      clause(PORT, COMPLETE, 'begin after complete without begin')
        .that(shape(await adapter.begin(scope, HASH_A)))
        .toEqual({ outcome: 'started' });
    });

    test('an in_progress key is taken over after 2 minutes', async ({ adapter, advance }) => {
      await adapter.begin(scope, HASH_A);
      await advance(IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS - 1);
      clause(PORT, EXPIRY, 'just before 2 minutes')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'in_progress' });
      await advance(1);
      clause(PORT, EXPIRY, 'at 2 minutes')
        .that(shape(await adapter.begin(scope, HASH_B)))
        .toEqual({ outcome: 'started' });
    });

    test('a completed key expires after 24 hours even if it was not deleted', async ({
      adapter,
      advance,
    }) => {
      const attemptId = await start(adapter, HASH_A);
      await adapter.complete(scope, attemptId, RESPONSE);
      await advance(IDEMPOTENCY_TTL_MS - 1);
      clause(PORT, EXPIRY, 'just before 24 hours')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'replay', response: RESPONSE });
      await advance(1);
      clause(PORT, EXPIRY, 'at 24 hours, with another hash')
        .that(shape(await adapter.begin(scope, HASH_B)))
        .toEqual({ outcome: 'started' });
      clause(PORT, EXPIRY, 'the replaced record has no stale response')
        .that(await adapter.begin(scope, HASH_B))
        .toEqual({ outcome: 'in_progress' });
    });

    test('a taken-over attempt cannot complete or release the newer attempt', async ({
      adapter,
      advance,
    }) => {
      const first = await start(adapter, HASH_A);
      await advance(IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS);
      const second = await start(adapter, HASH_A);
      await adapter.complete(scope, first, RESPONSE);
      clause(PORT, COMPLETE, 'complete with a stale attemptId changes nothing')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'in_progress' });
      await adapter.release(scope, first);
      clause(PORT, RELEASE, 'release with a stale attemptId changes nothing')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'in_progress' });
      await adapter.complete(scope, second, RESPONSE);
      clause(PORT, COMPLETE, 'the owning attempt still completes')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({ outcome: 'replay', response: RESPONSE });
    });

    test('complete stores the JSON form of the body (undefined fields dropped)', async ({
      adapter,
    }) => {
      const attemptId = await start(adapter, HASH_A);
      await adapter.complete(scope, attemptId, {
        status: 201,
        body: { id: 'x', gone: undefined, nested: { a: undefined, b: 1 } },
      });
      clause(PORT, COMPLETE, 'body with undefined fields')
        .that(await adapter.begin(scope, HASH_A))
        .toEqual({
          outcome: 'replay',
          response: { status: 201, body: { id: 'x', nested: { b: 1 } } },
        });
      await adapter.release(scope, attemptId);
      const other = { adminUid: 'admin-1', key: 'undef-body' };
      const id2 = await start(adapter, HASH_A, other);
      await adapter.complete(other, id2, { status: 204, body: undefined });
      clause(PORT, COMPLETE, 'undefined body')
        .that(await adapter.begin(other, HASH_A))
        .toEqual({ outcome: 'replay', response: { status: 204, body: null } });
    });
  });
}
