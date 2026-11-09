import type { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { FirestoreIdempotencyStore } from '../../src/adapters/firestore/idempotency-store.js';
import { IDEMPOTENCY_TTL_MS } from '../../src/ports/index.js';
import { describeIdempotencyStoreContract } from '../../src/testing/contracts/index.js';
import { FakeClock } from '../../src/testing/fakes/index.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

const db = getTestFirestore();

// The shared contract, against the emulator (each case starts from an empty database).
describeIdempotencyStoreContract('FirestoreIdempotencyStore (emulator)', async () => {
  await resetFirestore();
  const clock = new FakeClock();
  return {
    adapter: new FirestoreIdempotencyStore(db, clock),
    advance: (ms) => clock.advance(ms),
    cleanup: () => undefined,
  };
});

describe('FirestoreIdempotencyStore', () => {
  beforeEach(resetFirestore);

  it('stores idempotency/<adminUid>:<key> with hash, state, response and expiresAt (+24h)', async () => {
    const clock = new FakeClock();
    const store = new FirestoreIdempotencyStore(db, clock);
    const scope = { adminUid: 'uid-1', key: 'abc_DEF-123' };

    const begun = await store.begin(scope, 'h'.repeat(64));
    if (begun.outcome !== 'started') throw new Error('expected started');
    let data = (await db.collection('idempotency').doc('uid-1:abc_DEF-123').get()).data();
    expect(data?.['state']).toBe('in_progress');
    expect(data?.['requestHash']).toBe('h'.repeat(64));
    expect((data?.['expiresAt'] as Timestamp).toMillis()).toBe(
      clock.now().getTime() + IDEMPOTENCY_TTL_MS,
    );
    expect((data?.['createdAt'] as Timestamp).toDate()).toEqual(clock.now());

    await store.complete(scope, begun.attemptId, { status: 201, body: { ids: ['x'] } });
    data = (await db.collection('idempotency').doc('uid-1:abc_DEF-123').get()).data();
    expect(data).toMatchObject({
      state: 'completed',
      responseStatus: 201,
      responseBody: { ids: ['x'] },
    });
  });
});
