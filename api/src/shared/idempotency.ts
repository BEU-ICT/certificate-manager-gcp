import { createHash, timingSafeEqual } from 'node:crypto';
import type { IdempotencyScope } from '../ports/idempotency-store.js';

/** Header value rule: 1-128 characters of `[A-Za-z0-9_-]`. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Document id of a key: `<adminUid>:<key>`. */
export function idempotencyDocumentId(scope: IdempotencyScope): string {
  if (/[:/]/.test(scope.adminUid) || /[:/]/.test(scope.key)) {
    throw new Error('Idempotency scope parts must not contain ":" or "/"');
  }
  return `${scope.adminUid}:${scope.key}`;
}

/** JSON with object keys sorted at every level, so equal bodies hash equally whatever their key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** What a JSON round trip keeps: `undefined` fields and functions are dropped, `undefined` becomes `null`. */
export function jsonNormalise(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value) ?? 'null') as unknown;
}

/** Hex SHA-256 of the canonical form of `parts`. */
export function requestHash(...parts: readonly unknown[]): string {
  return createHash('sha256').update(canonicalJson(parts)).digest('hex');
}

/** Constant-time comparison of two hex hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
