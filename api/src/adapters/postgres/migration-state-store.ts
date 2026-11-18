import type { Clock, MigrationStateStore } from '../../ports/index.js';
import { SQL_MIGRATION_PREFIX } from './migrations/index.js';
import type { Queryable } from './db.js';

/**
 * PostgreSQL {@link MigrationStateStore} over `system_migrations`. `markApplied` is
 * `INSERT ... ON CONFLICT DO NOTHING`: only one of any number of concurrent callers inserts the
 * row. Schema migration markers (`sql/...`) share the table and are hidden from this store.
 */
export class PostgresMigrationStateStore implements MigrationStateStore {
  constructor(
    private readonly db: Queryable,
    private readonly clock: Clock,
  ) {}

  async appliedIds(): Promise<ReadonlySet<string>> {
    const { rows } = await this.db.query<{ id: string }>(
      'SELECT id FROM system_migrations WHERE left(id, $1) <> $2',
      [SQL_MIGRATION_PREFIX.length, SQL_MIGRATION_PREFIX],
    );
    return new Set(rows.map((r) => r.id));
  }

  async isApplied(id: string): Promise<boolean> {
    return (await this.appliedIds()).has(id);
  }

  async markApplied(id: string, by: string): Promise<boolean> {
    const r = await this.db.query(
      `INSERT INTO system_migrations (id, applied_at, applied_by) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [id, this.clock.now(), by],
    );
    return r.rowCount === 1;
  }

  async unmarkApplied(id: string, by: string): Promise<void> {
    await this.db.query('DELETE FROM system_migrations WHERE id = $1 AND applied_by = $2', [
      id,
      by,
    ]);
  }
}
