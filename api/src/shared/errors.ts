/** Error details entry, e.g. `{ path: "items[3].email", message: "Invalid email" }`. */
export interface ErrorDetail {
  path: string;
  message: string;
  /** Retry hint for `SLUG_TAKEN`: a free slug the client may submit instead. */
  suggestion?: string;
  /** Reference counts for `IN_USE`, e.g. `{ events: 2, certificates: 10 }`. */
  counts?: Record<string, number>;
}

/**
 * Base class for every error that is safe to show to API clients. The message
 * of an `AppError` is sent to the caller verbatim, so it must never contain
 * secrets, SDK/SQL messages, internal paths or personal data.
 * Mapping to HTTP follows BEU-ICT/certificate-manager#23 section 4.
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetail[];
  /** Extra response headers (e.g. `Retry-After`). */
  readonly headers: Readonly<Record<string, string>> = {};

  constructor(code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  constructor(message = 'Request validation failed', details?: ErrorDetail[]) {
    super('VALIDATION_FAILED', message, details);
  }
}

export class UnauthenticatedError extends AppError {
  readonly statusCode = 401;
  constructor(message = 'Authentication is required') {
    super('UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  constructor(message = 'You are not allowed to perform this action') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  constructor(message = 'Resource not found', details?: ErrorDetail[]) {
    super('NOT_FOUND', message, details);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  constructor(message = 'Request conflicts with the current state', details?: ErrorDetail[]) {
    super('CONFLICT', message, details);
  }
}

/** A unique slug is already reserved. `suggestion` is a free alternative when the caller knows one. */
export class SlugTakenError extends ConflictError {
  constructor(entity: string, suggestion?: string) {
    super(`${entity} slug is already taken`, [
      { path: 'slug', message: 'SLUG_TAKEN', ...(suggestion !== undefined && { suggestion }) },
    ]);
  }
}

/** The record is still referenced by other records and cannot be deleted. */
export class InUseError extends ConflictError {
  constructor(entity: string, counts: Record<string, number>) {
    super(`${entity} is still referenced and cannot be deleted`, [
      { path: 'references', message: 'IN_USE', counts },
    ]);
  }
}

export class GoneError extends AppError {
  readonly statusCode = 410;
  constructor(message = 'Resource is no longer available') {
    super('GONE', message);
  }
}

export class PayloadTooLargeError extends AppError {
  readonly statusCode = 413;
  constructor(message = 'Request body is too large') {
    super('PAYLOAD_TOO_LARGE', message);
  }
}

/** Well-formed request that violates a business rule; `code` is domain specific. */
export class UnprocessableError extends AppError {
  readonly statusCode = 422;
  constructor(code: string, message: string, details?: ErrorDetail[]) {
    super(code, message, details);
  }
}

export class RateLimitedError extends AppError {
  readonly statusCode = 429;
  override readonly headers: Readonly<Record<string, string>>;
  constructor(retryAfterSeconds = 60, message = 'Too many requests') {
    super('RATE_LIMITED', message);
    this.headers = { 'retry-after': String(retryAfterSeconds) };
  }
}

export class UnavailableError extends AppError {
  readonly statusCode = 503;
  override readonly headers: Readonly<Record<string, string>>;
  constructor(retryAfterSeconds = 5, message = 'Service temporarily unavailable') {
    super('UNAVAILABLE', message);
    this.headers = { 'retry-after': String(retryAfterSeconds) };
  }
}
