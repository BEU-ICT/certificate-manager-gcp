import type { ZodType } from 'zod';
import { ErrorBodyDto } from '../dto/public/error.js';

/** A JSON response with a description (OpenAPI requires one per response). */
export function jsonResponse<T extends ZodType>(
  description: string,
  schema: T,
): { description: string; content: { 'application/json': { schema: T } } } {
  return { description, content: { 'application/json': { schema } } };
}

const ERROR_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: 'VALIDATION_FAILED: malformed or invalid request',
  401: 'UNAUTHENTICATED: missing or invalid credentials',
  403: 'FORBIDDEN: not allowed to perform this action',
  404: 'NOT_FOUND: resource does not exist',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT: conflicts with the current state',
  410: 'GONE: resource is no longer available',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'Well-formed request that violates a business rule (domain specific code)',
  429: 'RATE_LIMITED: retry after the Retry-After header',
  500: 'INTERNAL: unexpected error',
  503: 'UNAVAILABLE: retry after the Retry-After header',
};

type ErrorResponse = ReturnType<typeof jsonResponse<typeof ErrorBodyDto>>;

/**
 * Error responses documented with the shared error schema. Spread into a route's
 * `schema.response`, e.g. `response: { 200: jsonResponse('Ok', Dto), ...errorResponses(400, 404) }`.
 * 429, 500 and 503 can occur on any route, so they are always included.
 */
export function errorResponses<const S extends number>(
  ...statuses: S[]
): Record<S | 429 | 500 | 503, ErrorResponse> {
  const all = new Set<number>([...statuses, 429, 500, 503]);
  return Object.fromEntries(
    [...all].map((s) => [
      s,
      jsonResponse(ERROR_DESCRIPTIONS[s] ?? `Error ${String(s)}`, ErrorBodyDto),
    ]),
  ) as Record<S | 429 | 500 | 503, ErrorResponse>;
}
