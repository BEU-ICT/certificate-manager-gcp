import { sql as initialSchema } from './001-initial-schema.js';
import { sql as binaryCollation } from './002-binary-collation.js';

export interface SqlMigration {
  /** Stable id, recorded in `system_migrations` as `sql/<id>`. */
  readonly id: string;
  readonly sql: string;
}

/** Ordered, append-only. Never edit a released migration: add a new one. */
export const SQL_MIGRATIONS: readonly SqlMigration[] = [
  { id: '001-initial-schema', sql: initialSchema },
  { id: '002-binary-collation', sql: binaryCollation },
];

/** Prefix that keeps schema migrations apart from data migration markers in `system_migrations`. */
export const SQL_MIGRATION_PREFIX = 'sql/';
