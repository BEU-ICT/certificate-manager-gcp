import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS,
  IDEMPOTENCY_TTL_MS,
  type Clock,
  type IdempotencyBegin,
  type IdempotencyScope,
  type IdempotencyStore,
  type StoredResponse,
} from '../../ports/index.js';
import { hashesEqual, idempotencyDocumentId, jsonNormalise } from '../../shared/idempotency.js';
import { SCHEMA_VERSION } from '../../shared/schema-version.js';

/** Collection `idempotency`, document id `<adminUid>:<key>`; a Firestore TTL policy on `expiresAt` prunes it. */
export const IDEMPOTENCY_COLLECTION = 'idempotency';

interface IdempotencyDocument {
  requestHash?: string;
  attemptId?: string;
  state?: 'in_progress' | 'completed';
  responseStatus?: number;
  responseBody?: unknown;
  createdAt?: Timestamp;
  expiresAt?: Timestamp;
}

/**
 * Firestore implementation of {@link IdempotencyStore}. `begin` is one transaction (read the key
 * document, create or replace it only when no live record exists), so concurrent callers are
 * serialised and exactly one starts. Expiry is checked against `expiresAt` here because the TTL
 * deletion can lag by up to a day.
 */
export class FirestoreIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly db: Firestore,
    private readonly clock: Clock,
  ) {}

  private ref(scope: IdempotencyScope) {
    return this.db.collection(IDEMPOTENCY_COLLECTION).doc(idempotencyDocumentId(scope));
  }

  begin(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyBegin> {
    const ref = this.ref(scope);
    return this.db.runTransaction(async (tx): Promise<IdempotencyBegin> => {
      const data = (await tx.get(ref)).data() as IdempotencyDocument | undefined;
      const now = this.clock.now();
      const stale =
        data === undefined ||
        data.expiresAt === undefined ||
        data.expiresAt.toMillis() <= now.getTime() ||
        (data.state === 'in_progress' &&
          data.createdAt !== undefined &&
          now.getTime() - data.createdAt.toMillis() >= IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS);
      if (stale) {
        // Full replacement (no merge) drops any previous response fields.
        const attemptId = randomUUID();
        tx.set(ref, {
          schemaVersion: SCHEMA_VERSION,
          requestHash,
          attemptId,
          state: 'in_progress',
          createdAt: Timestamp.fromDate(now),
          expiresAt: Timestamp.fromMillis(now.getTime() + IDEMPOTENCY_TTL_MS),
        });
        return { outcome: 'started', attemptId };
      }
      if (typeof data.requestHash !== 'string' || !hashesEqual(data.requestHash, requestHash)) {
        return { outcome: 'mismatch' };
      }
      if (data.state === 'completed' && typeof data.responseStatus === 'number') {
        return {
          outcome: 'replay',
          response: { status: data.responseStatus, body: data.responseBody ?? null },
        };
      }
      return { outcome: 'in_progress' };
    });
  }

  complete(scope: IdempotencyScope, attemptId: string, response: StoredResponse): Promise<void> {
    const ref = this.ref(scope);
    const body = jsonNormalise(response.body);
    return this.db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() as IdempotencyDocument | undefined;
      if (data?.state !== 'in_progress' || data.attemptId !== attemptId) return;
      tx.update(ref, {
        state: 'completed',
        responseStatus: response.status,
        responseBody: body,
      });
    });
  }

  release(scope: IdempotencyScope, attemptId: string): Promise<void> {
    const ref = this.ref(scope);
    return this.db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data() as IdempotencyDocument | undefined;
      if (data?.state === 'in_progress' && data.attemptId === attemptId) tx.delete(ref);
    });
  }
}
