import type { Cursor, PageRequest } from '../ports/common.js';
import { ValidationError } from './errors.js';
import { isCertificateId } from './ids.js';

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

/** Certificate list cursor: `[issuedAtMillis, id]` of the last item, validated on decode. */
export function encodeIssuedAtCursor(issuedAt: Date, id: string): Cursor {
  return encodeCursor([issuedAt.getTime(), id]);
}

/** Valid JS Date range: 0001-01-01T00:00:00Z .. 9999-12-31T23:59:59.999Z. */
const MIN_MILLIS = -62_135_596_800_000;
const MAX_MILLIS = 253_402_300_799_999;

export function decodeIssuedAtCursor(cursor: string): { issuedAtMillis: number; id: string } {
  const [millis, id] = decodeCursor(cursor, 2);
  if (
    typeof millis !== 'number' ||
    !Number.isSafeInteger(millis) ||
    millis < MIN_MILLIS ||
    millis > MAX_MILLIS ||
    !isCertificateId(id)
  ) {
    throw new ValidationError('Invalid cursor');
  }
  return { issuedAtMillis: millis, id };
}
