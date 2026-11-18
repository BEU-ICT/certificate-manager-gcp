import type { Cursor, Page } from '../../ports/common.js';
import { encodeCursor } from '../../shared/cursor.js';

export interface KeysetColumn {
  /** SQL column name (a constant of the adapter, never user input). */
  readonly column: string;
  readonly direction: 'asc' | 'desc';
}

const COLUMN = /^[a-z_][a-z0-9_.]*$/;

function assertColumns(columns: readonly KeysetColumn[]): void {
  if (columns.length === 0) throw new RangeError('keyset needs at least one column');
  for (const c of columns) if (!COLUMN.test(c.column)) throw new RangeError('invalid column name');
}

/** `ORDER BY a desc, b desc` for the given sort key. */
export function keysetOrderBy(columns: readonly KeysetColumn[]): string {
  assertColumns(columns);
  return `ORDER BY ${columns.map((c) => `${c.column} ${c.direction.toUpperCase()}`).join(', ')}`;
}

/**
 * Condition selecting the rows strictly after the cursor `values` in the sort order, using
 * placeholders `$start`, `$start + 1`, ... (one per column). Equal directions use a row-value
 * comparison (`(a, b) < ($1, $2)`), which Postgres serves from a composite index; mixed directions
 * expand to an OR chain. The same total order as the Firestore queries (`orderBy(x).orderBy(id)`).
 */
export function keysetCondition(
  columns: readonly KeysetColumn[],
  values: readonly unknown[],
  startParam: number,
): { sql: string; params: unknown[] } {
  assertColumns(columns);
  if (values.length !== columns.length) throw new RangeError('cursor arity mismatch');
  const op = (c: KeysetColumn) => (c.direction === 'desc' ? '<' : '>');
  const first = columns[0] as KeysetColumn;
  if (columns.every((c) => c.direction === first.direction)) {
    const names = columns.map((c) => c.column).join(', ');
    const marks = columns.map((_, i) => `$${String(startParam + i)}`).join(', ');
    return { sql: `(${names}) ${op(first)} (${marks})`, params: [...values] };
  }
  const branches = columns.map((c, i) => {
    const equal = columns
      .slice(0, i)
      .map((p, j) => `${p.column} = $${String(startParam + j)}`)
      .concat(`${c.column} ${op(c)} $${String(startParam + i)}`);
    return `(${equal.join(' AND ')})`;
  });
  return { sql: `(${branches.join(' OR ')})`, params: [...values] };
}

/**
 * Turns `limit + 1` fetched rows into a page: the extra row only decides `nextCursor`, which is
 * built from the sort key of the last returned row.
 */
export function toKeysetPage<T>(
  rows: readonly T[],
  limit: number,
  cursorValues: (row: T) => readonly (string | number)[],
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor: Cursor | null =
    rows.length > limit && last !== undefined ? encodeCursor(cursorValues(last)) : null;
  return { items: [...items], nextCursor };
}
