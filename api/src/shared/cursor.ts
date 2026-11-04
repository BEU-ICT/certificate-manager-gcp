import type { Cursor, PageRequest } from '../ports/common.js';
import { ValidationError } from './errors.js';

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 50;

/** Validated page size (1..50, default 25). */
export function pageLimit(request: PageRequest | undefined): number {
  const limit = request?.limit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ValidationError(`limit must be an integer between 1 and ${String(MAX_PAGE_LIMIT)}`);
  }
  return limit;
}

/** Opaque cursor carrying the sort key of the last item of a page. */
export function encodeCursor(values: readonly (string | number)[]): Cursor {
  return Buffer.from(JSON.stringify(values)).toString('base64url') as Cursor;
}

/** Decodes a cursor made of `arity` strings/numbers; anything else is a client error. */
export function decodeCursor(cursor: string, arity: number): (string | number)[] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === arity &&
      value.every((v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
    ) {
      return value as (string | number)[];
    }
  } catch {
    // fall through
  }
  throw new ValidationError('Invalid cursor');
}
