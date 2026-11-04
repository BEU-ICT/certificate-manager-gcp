/** Who applied a migration and when; stored as `applied.<id>` in the marker document. */
export interface MigrationMarker {
  at: Date;
  /** Identifier of the process (Cloud Run instance) that claimed the migration. */
  by: string;
}

/**
 * Records which data migrations have run. All markers live in one document, so reading them
 * costs a single read. Markers are claimed before the migration body runs, which is what makes
 * parallel instances run a migration at most once.
 */
export interface MigrationStateStore {
  /** Whether a marker exists for `id`. */
  isApplied(id: string): Promise<boolean>;

  /** Ids of every marked migration, in one read. Used by the runner at startup. */
  appliedIds(): Promise<ReadonlySet<string>>;

  /**
   * Atomically claims `id` for `by`: writes the marker `{ at, by }` only when none exists.
   * Resolves `true` for exactly one of any number of concurrent callers (the winner, who must
   * run the migration) and `false` for every other caller (they skip it). A marker that already
   * exists is never overwritten.
   */
  markApplied(id: string, by: string): Promise<boolean>;

  /**
   * Removes the marker of `id` when it is held by `by`, so that a failed migration is retried
   * on the next start. A missing marker, or one held by another instance, is left untouched and
   * counts as success.
   */
  unmarkApplied(id: string, by: string): Promise<void>;
}
