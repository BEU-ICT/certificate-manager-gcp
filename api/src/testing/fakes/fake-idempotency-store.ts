import { randomUUID } from 'node:crypto';
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

interface Entry {
  requestHash: string;
  attemptId: string;
  state: 'in_progress' | 'completed';
  response?: StoredResponse;
  createdAt: Date;
  expiresAt: Date;
}

/** In-memory store; each method runs synchronously inside its promise, so `begin` is atomic. */
export class FakeIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly clock: Clock) {}

  begin(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyBegin> {
    const id = idempotencyDocumentId(scope);
    const now = this.clock.now();
    const existing = this.entries.get(id);
    const live =
      existing !== undefined &&
      existing.expiresAt.getTime() > now.getTime() &&
      !(
        existing.state === 'in_progress' &&
        now.getTime() - existing.createdAt.getTime() >= IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS
      );
    if (!live) {
      const attemptId = randomUUID();
      this.entries.set(id, {
        requestHash,
        attemptId,
        state: 'in_progress',
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      });
      return Promise.resolve({ outcome: 'started', attemptId });
    }
    if (!hashesEqual(existing.requestHash, requestHash)) {
      return Promise.resolve({ outcome: 'mismatch' });
    }
    if (existing.state === 'completed' && existing.response !== undefined) {
      return Promise.resolve({ outcome: 'replay', response: existing.response });
    }
    return Promise.resolve({ outcome: 'in_progress' });
  }

  complete(scope: IdempotencyScope, attemptId: string, response: StoredResponse): Promise<void> {
    const entry = this.entries.get(idempotencyDocumentId(scope));
    if (entry?.state === 'in_progress' && entry.attemptId === attemptId) {
      entry.state = 'completed';
      entry.response = { status: response.status, body: jsonNormalise(response.body) };
    }
    return Promise.resolve();
  }

  release(scope: IdempotencyScope, attemptId: string): Promise<void> {
    const id = idempotencyDocumentId(scope);
    const entry = this.entries.get(id);
    if (entry?.state === 'in_progress' && entry.attemptId === attemptId) this.entries.delete(id);
    return Promise.resolve();
  }

  /** Number of stored records, for assertions. */
  get size(): number {
    return this.entries.size;
  }
}
