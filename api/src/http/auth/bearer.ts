import { UnauthenticatedError } from '../../shared/errors.js';

export const MAX_BEARER_TOKEN_LENGTH = 4096;

/**
 * Extracts the token from `Authorization: Bearer <token>`. Anything else (missing header, other
 * scheme, several headers, empty or oversized token) is the same `UnauthenticatedError`.
 */
export function parseBearerToken(header: string | string[] | undefined): string {
  if (typeof header !== 'string') throw new UnauthenticatedError();
  const match = /^Bearer ([^\s,]+)$/.exec(header);
  const token = match?.[1];
  if (token === undefined || token.length > MAX_BEARER_TOKEN_LENGTH) {
    throw new UnauthenticatedError();
  }
  return token;
}
