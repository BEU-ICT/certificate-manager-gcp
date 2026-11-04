import type { Cursor, Page, PageRequest } from '../../ports/common.js';
import { ValidationError } from '../../shared/errors.js';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 50;

export interface Row<T> {
  item: T;
  /** Sort key in epoch milliseconds (createdAt / issuedAt). */
  time: number;
  /** Insertion order; breaks ties so ordering is total and stable. */
  seq: number;
}

/** Insertion-ordered rows with newest-first, opaque-cursor pagination shared by repository fakes. */
export class MemoryTable<T> {
  readonly rows: Row<T>[] = [];
  private seq = 0;

  add(item: T, time: Date): void {
    this.rows.push({ item: structuredClone(item), time: time.getTime(), seq: this.seq++ });
  }

  find(predicate: (item: T) => boolean): Row<T> | undefined {
    return this.rows.find((row) => predicate(row.item));
  }

  select(predicate: (item: T) => boolean = () => true): Row<T>[] {
    return this.rows.filter((row) => predicate(row.item));
  }

  paginate(rows: readonly Row<T>[], request: PageRequest = {}): Page<T> {
    const limit = request.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new ValidationError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    const after = request.cursor === undefined ? null : decodeCursor(request.cursor);
    const sorted = [...rows].sort((a, b) => b.time - a.time || b.seq - a.seq);
    const rest = after
      ? sorted.filter((r) => r.time < after[0] || (r.time === after[0] && r.seq < after[1]))
      : sorted;
    const page = rest.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rest.length > limit && last ? encodeCursor(last) : null;
    return { items: page.map((r) => structuredClone(r.item)), nextCursor };
  }
}

function encodeCursor(row: Row<unknown>): Cursor {
  return Buffer.from(JSON.stringify([row.time, row.seq])).toString('base64url') as Cursor;
}

function decodeCursor(cursor: string): [number, number] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      return [value[0] as number, value[1] as number];
    }
  } catch {
    // fall through
  }
  throw new ValidationError('Invalid cursor');
}
