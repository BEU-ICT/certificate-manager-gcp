import type { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { FirestoreEmailQuotaStore } from '../../src/adapters/firestore/email-quota-store.js';
import { describeEmailQuotaStoreContract } from '../../src/testing/contracts/index.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

const db = getTestFirestore();

// The shared contract (including 100 parallel reservations with cap 50), against the emulator.
describeEmailQuotaStoreContract('FirestoreEmailQuotaStore (emulator)', async () => {
  await resetFirestore();
  return { adapter: new FirestoreEmailQuotaStore(db), cleanup: () => undefined };
});

describe('FirestoreEmailQuotaStore', () => {
  beforeEach(resetFirestore);

  it('stores email_counters/<provider>:<day> with used and an expiresAt after the day ends', async () => {
    const store = new FirestoreEmailQuotaStore(db);
    await store.tryReserve('gmail', '2026-11-12', 5);
    await store.tryReserve('gmail', '2026-11-12', 5);
    const data = (await db.collection('email_counters').doc('gmail:2026-11-12').get()).data();
    expect(data?.['used']).toBe(2);
    expect(data?.['provider']).toBe('gmail');
    expect((data?.['expiresAt'] as Timestamp).toDate().toISOString()).toBe(
      '2026-11-15T00:00:00.000Z',
    );
  });
});
