import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { IdempotencyScope, IdempotencyStore } from '../ports/index.js';
import {
  AppError,
  UnauthenticatedError,
  UnprocessableError,
  ValidationError,
} from '../shared/errors.js';
import { IDEMPOTENCY_KEY_PATTERN, requestHash } from '../shared/idempotency.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

/** Documents the optional header in a route's OpenAPI `headers` schema. */
export const IdempotencyKeyHeaderDto = z
  .object({
    'idempotency-key': z
      .string()
      .regex(IDEMPOTENCY_KEY_PATTERN, 'Must be 1-128 characters of A-Z a-z 0-9 _ -')
      .optional()
      .describe(
        'Optional retry key, scoped to the calling administrator and kept for 24 hours. Repeating a completed request with the same key returns the stored response with `Idempotent-Replayed: true`; the same key with another body yields 422 `IDEMPOTENCY_KEY_REUSED`; a concurrent duplicate yields 409 `REQUEST_IN_PROGRESS`.',
      ),
  })
  .passthrough();

/** 409: the same request is being executed right now; retry shortly. */
export class RequestInProgressError extends AppError {
  readonly statusCode = 409;
  override readonly headers: Readonly<Record<string, string>> = { 'retry-after': '2' };
  constructor() {
    super('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
  }
}

/** 422: the key was already used with a different request. */
export class IdempotencyKeyReusedError extends UnprocessableError {
  constructor() {
    super(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with a different request',
    );
  }
}

/**
 * What an idempotent handler returns. `body` is stored and replayed verbatim, so it must hold
 * identifiers only (no names, emails or other personal data).
 */
export interface IdempotentResult {
  status: number;
  body: unknown;
}

function isClientError(error: unknown): boolean {
  if (error instanceof AppError) return error.statusCode >= 400 && error.statusCode < 500;
  const { statusCode } = (error ?? {}) as { statusCode?: unknown };
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500;
}

function parseKey(request: FastifyRequest): string | undefined {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    throw new ValidationError('Request validation failed', [
      {
        path: 'Idempotency-Key',
        message: 'Must be 1-128 characters of A-Z a-z 0-9 _ -',
      },
    ]);
  }
  return raw;
}

/**
 * Wraps a route handler with `Idempotency-Key` support. Without the header the handler runs
 * unchanged. With it (scope = calling administrator + key):
 * - first request: runs the handler and stores its `{ status, body }` as completed;
 * - same request again: replays the stored response with `Idempotent-Replayed: true`, runs nothing;
 * - same request while the first runs: 409 `REQUEST_IN_PROGRESS`;
 * - same key, different method/route/body: 422 `IDEMPOTENCY_KEY_REUSED`;
 * - handler fails with, or returns, a client error (4xx): the key is released so a corrected request can reuse it.
 * Complete/release carry the attempt id from `begin`, so a caller whose key was taken over cannot
 * alter the newer attempt. After a server error (thrown or returned 5xx) the key stays `in_progress` and can be taken over after 2 minutes, because
 * the write may have partly happened.
 *
 * Use inside admin routes only (needs `request.adminUid`). Usage:
 * `r.post('/x', opts, withIdempotency(services.idempotency, async (req) => ({ status: 201, body })))`
 */
export function withIdempotency<Req extends FastifyRequest>(
  store: IdempotencyStore,
  handler: (request: Req, reply: FastifyReply) => Promise<IdempotentResult>,
): (request: Req, reply: FastifyReply) => Promise<FastifyReply> {
  return async (request, reply) => {
    const key = parseKey(request);
    if (key === undefined) {
      const result = await handler(request, reply);
      return reply.status(result.status).send(result.body);
    }
    if (request.adminUid === undefined) throw new UnauthenticatedError();
    const scope: IdempotencyScope = { adminUid: request.adminUid, key };
    const hash = requestHash(
      request.method,
      request.routeOptions.url ?? '',
      request.params ?? null,
      request.body ?? null,
    );

    const begun = await store.begin(scope, hash);
    switch (begun.outcome) {
      case 'replay':
        return reply
          .header(IDEMPOTENT_REPLAYED_HEADER, 'true')
          .status(begun.response.status)
          .send(begun.response.body);
      case 'in_progress':
        throw new RequestInProgressError();
      case 'mismatch':
        throw new IdempotencyKeyReusedError();
      case 'started':
        break;
    }

    let result: IdempotentResult;
    try {
      result = await handler(request, reply);
    } catch (error) {
      if (isClientError(error)) await release(store, scope, begun.attemptId, request);
      throw error;
    }
    if (result.status >= 400 && result.status < 500) {
      await release(store, scope, begun.attemptId, request);
    } else if (result.status < 500) {
      try {
        await store.complete(scope, begun.attemptId, { status: result.status, body: result.body });
      } catch {
        // The operation succeeded; a failed bookkeeping write must not turn it into an error.
        // The key stays in_progress and a retry takes over after 2 minutes.
        request.log.warn({ code: 'IDEMPOTENCY_COMPLETE_FAILED' }, 'could not store response');
      }
    }
    return reply.status(result.status).send(result.body);
  };
}

async function release(
  store: IdempotencyStore,
  scope: IdempotencyScope,
  attemptId: string,
  request: FastifyRequest,
): Promise<void> {
  try {
    await store.release(scope, attemptId);
  } catch {
    request.log.warn({ code: 'IDEMPOTENCY_RELEASE_FAILED' }, 'could not release key');
  }
}
