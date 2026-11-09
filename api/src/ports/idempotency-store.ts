/** How long a stored key (and its response) is honoured: 24 hours. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** An `in_progress` key older than this is presumed abandoned and may be taken over: 2 minutes. */
export const IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS = 2 * 60 * 1000;

/** Scope of a key: keys of different administrators never collide. */
export interface IdempotencyScope {
  adminUid: string;
  key: string;
}

/** The response that was stored for a completed request. Must hold identifiers only, no personal data. */
export interface StoredResponse {
  status: number;
  body: unknown;
}

/** Result of {@link IdempotencyStore.begin}. */
export type IdempotencyBegin =
  /**
   * The caller owns the key and must run the operation, then `complete` or `release` with the
   * returned `attemptId` (a random id of this attempt, stored on the record).
   */
  | { outcome: 'started'; attemptId: string }
  /** Same request already finished: answer with the stored response, run nothing. */
  | { outcome: 'replay'; response: StoredResponse }
  /** Same request is being executed right now (started less than 2 minutes ago). */
  | { outcome: 'in_progress' }
  /** The key was used with a different request. */
  | { outcome: 'mismatch' };

/**
 * Remembers the outcome of requests that carry an `Idempotency-Key`, so a retry does not repeat
 * the operation. A record is `{ requestHash, state, response?, createdAt, expiresAt }` and is
 * honoured for 24 hours ({@link IDEMPOTENCY_TTL_MS}); the database may delete expired records late
 * (Firestore TTL), so adapters compare `expiresAt` with the clock themselves.
 */
export interface IdempotencyStore {
  /**
   * Atomically looks the key up and, when there is no live record, creates it as `in_progress`
   * (a record that expired, or that has been `in_progress` for 2 minutes or longer, counts as
   * absent and is replaced). For any number of concurrent callers with the same key exactly one
   * gets `started`. Otherwise: same `requestHash` and `completed` gives `replay`; same hash and
   * `in_progress` gives `in_progress`; a different hash gives `mismatch`. Hashes are compared in
   * constant time.
   */
  begin(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyBegin>;

  /**
   * Marks an `in_progress` key `completed` with the response to replay, but only when the record's
   * `attemptId` equals the given one (a caller whose attempt was taken over after the 2-minute
   * timeout must not alter the newer attempt's record). Otherwise nothing changes. The body is
   * JSON-normalised before it is stored (`undefined` fields dropped).
   */
  complete(scope: IdempotencyScope, attemptId: string, response: StoredResponse): Promise<void>;

  /**
   * Deletes the key when it is still `in_progress` and its `attemptId` equals the given one, so a
   * corrected request can reuse it. A missing, `completed` or taken-over key is left untouched and
   * counts as success.
   */
  release(scope: IdempotencyScope, attemptId: string): Promise<void>;
}
