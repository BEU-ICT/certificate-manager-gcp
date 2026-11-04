/** Opaque pagination cursor; clients and callers never parse it. */
export type Cursor = string & { readonly __cursor: true };

/** One page of results. `nextCursor` is `null` on the last page. */
export interface Page<T> {
  items: T[];
  nextCursor: Cursor | null;
}

export interface PageRequest {
  /** 1..50, default 25. */
  limit?: number;
  cursor?: Cursor;
}

export type FilterScalar = string | number | boolean | Date;

/** Equality (scalar) or inclusive range filter on one field. */
export type FilterValue = FilterScalar | { gte?: FilterScalar; lte?: FilterScalar };

/** Field name to condition; all conditions are ANDed. Unknown fields are a programming error. */
export type Filter = Readonly<Record<string, FilterValue | undefined>>;
