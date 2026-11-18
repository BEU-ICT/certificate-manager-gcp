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
import { SCHEMA_VERSION } from '../../shared/schema-version.js';
import type { Queryable } from './db.js';

interface Row {
  request_hash: string;
  state: 'in_progress' | 'completed';
  response_status: number | null;
  response_body: unknown;
}

/**
 * PostgreSQL {@link IdempotencyStore}. `begin` is one `INSERT ... ON CONFLICT DO UPDATE ... WHERE`
 * statement: the update only fires for an expired or abandoned record, and concurrent callers
 * queue on the row lock, so exactly one gets `started`. Expiry is checked against the injected
 * clock (the table has no TTL job; expired rows are replaced lazily).
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly db: Queryable,
    private readonly clock: Clock,
  ) {}

  async begin(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyBegin> {
    const id = idempotencyDocumentId(scope);
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = this.clock.now();
      const attemptId = randomUUID();
      const started = await this.db.query(
        `INSERT INTO idempotency (id, request_hash, attempt_id, state, created_at, expires_at, schema_version)
         VALUES ($1, $2, $3, 'in_progress', $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET request_hash = EXCLUDED.request_hash,
           attempt_id = EXCLUDED.attempt_id, state = 'in_progress', response_status = NULL,
           response_body = NULL, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at
         WHERE idempotency.expires_at <= $4
            OR (idempotency.state = 'in_progress' AND idempotency.created_at <= $7)
         RETURNING attempt_id`,
        [
          id,
          requestHash,
          attemptId,
          now,
          new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          SCHEMA_VERSION,
          new Date(now.getTime() - IDEMPOTENCY_IN_PROGRESS_TIMEOUT_MS),
        ],
      );
      if (started.rows[0]) return { outcome: 'started', attemptId };
      const { rows } = await this.db.query<Row>(
        'SELECT request_hash, state, response_status, response_body FROM idempotency WHERE id = $1',
        [id],
      );
      const row = rows[0];
      if (!row) continue; // deleted in between (release): try to start again
      if (!hashesEqual(row.request_hash, requestHash)) return { outcome: 'mismatch' };
      if (row.state === 'completed' && row.response_status !== null) {
        return {
          outcome: 'replay',
          response: { status: row.response_status, body: row.response_body ?? null },
        };
      }
      return { outcome: 'in_progress' };
    }
    return { outcome: 'in_progress' };
  }

  async complete(
    scope: IdempotencyScope,
    attemptId: string,
    response: StoredResponse,
  ): Promise<void> {
    await this.db.query(
      `UPDATE idempotency SET state = 'completed', response_status = $3, response_body = $4::jsonb
       WHERE id = $1 AND state = 'in_progress' AND attempt_id = $2`,
      [
        idempotencyDocumentId(scope),
        attemptId,
        response.status,
        JSON.stringify(jsonNormalise(response.body)),
      ],
    );
  }

  async release(scope: IdempotencyScope, attemptId: string): Promise<void> {
    await this.db.query(
      "DELETE FROM idempotency WHERE id = $1 AND state = 'in_progress' AND attempt_id = $2",
      [idempotencyDocumentId(scope), attemptId],
    );
  }
}
