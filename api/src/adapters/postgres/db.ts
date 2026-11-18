import type { Pool, PoolClient } from 'pg';
import { ConflictError } from '../../shared/errors.js';

/** Anything that runs parameterised queries: the pool or one checked-out connection. */
export type Queryable = Pick<Pool | PoolClient, 'query'>;

/** SQLSTATE `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** Name of the violated unique constraint/index, or `undefined` when `error` is not one. */
export function uniqueViolation(error: unknown): string | undefined {
  const e = error as { code?: unknown; constraint?: unknown } | null;
  if (e?.code !== UNIQUE_VIOLATION) return undefined;
  return typeof e.constraint === 'string' ? e.constraint : '';
}

/** Runs `work`; a unique violation becomes `onConflict(constraint)` (a `ConflictError`). */
export async function mapConflict<T>(
  work: () => Promise<T>,
  onConflict: (constraint: string) => ConflictError,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint !== undefined) throw onConflict(constraint);
    throw error;
  }
}
