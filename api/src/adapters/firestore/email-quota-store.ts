import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { EmailQuotaStore, QuotaReservation } from '../../ports/index.js';
import { assertCap, emailCounterExpiry, emailCounterId } from '../../shared/email-quota.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';

/** Collection `email_counters`, document id `<provider>:<YYYY-MM-DD UTC>`; a TTL policy on `expiresAt` prunes it. */
export const EMAIL_COUNTERS_COLLECTION = 'email_counters';

/** Reservations of one day contend on a single document; allow more retries than the default 5. */
const TRANSACTION_ATTEMPTS = 30;

interface CounterDocument {
  used?: number;
}

/**
 * Firestore implementation of {@link EmailQuotaStore}. `tryReserve` is one transaction with one
 * read and one write (the budget is at most two operations per e-mail); `release` runs only for
 * deliveries that failed.
 */
export class FirestoreEmailQuotaStore implements EmailQuotaStore {
  /**
   * Calls of this instance for the same counter run one after another: many parallel transactions
   * on one document would only abort and retry each other. Across instances the transaction
   * itself keeps the cap exact.
   */
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(private readonly db: Firestore) {}

  private serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(run, run);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  private ref(provider: string, day: string) {
    return this.db.collection(EMAIL_COUNTERS_COLLECTION).doc(emailCounterId(provider, day));
  }

  async tryReserve(provider: string, day: string, cap: number): Promise<QuotaReservation> {
    assertCap(cap);
    const ref = this.ref(provider, day);
    return await this.serialized(ref.path, () =>
      this.db.runTransaction(
        async (tx): Promise<QuotaReservation> => {
          const data = (await tx.get(ref)).data() as CounterDocument | undefined;
          const used = typeof data?.used === 'number' ? data.used : 0;
          if (used >= cap) return { granted: false, used };
          tx.set(ref, {
            schemaVersion: SCHEMA_VERSION,
            provider,
            day,
            used: used + 1,
            expiresAt: Timestamp.fromDate(emailCounterExpiry(day)),
          });
          return { granted: true, used: used + 1 };
        },
        { maxAttempts: TRANSACTION_ATTEMPTS },
      ),
    );
  }

  async release(provider: string, day: string): Promise<void> {
    const ref = this.ref(provider, day);
    await this.serialized(ref.path, () =>
      this.db.runTransaction(
        async (tx) => {
          const data = (await tx.get(ref)).data() as CounterDocument | undefined;
          if (typeof data?.used === 'number' && data.used > 0)
            tx.update(ref, { used: data.used - 1 });
        },
        { maxAttempts: TRANSACTION_ATTEMPTS },
      ),
    );
  }
}
