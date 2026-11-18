import type { Pool } from 'pg';
import { SQL_MIGRATIONS, SQL_MIGRATION_PREFIX, type SqlMigration } from './migrations/index.js';

/** Arbitrary constant: serialises concurrent migrators (several instances starting together). */
const ADVISORY_LOCK_KEY = 4290429;

export interface SqlMigrationReport {
  applied: string[];
  skipped: string[];
}

const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS system_migrations (
  id         text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL
)`;

/**
 * Applies pending numbered SQL migrations, each in its own transaction, under an advisory lock.
 * Safe to run repeatedly and concurrently. Needs a role with DDL rights; the runtime role of the
 * server does not (least privilege).
 */
export async function runSqlMigrations(
  pool: Pool,
  by: string,
  migrations: readonly SqlMigration[] = SQL_MIGRATIONS,
): Promise<SqlMigrationReport> {
  const ids = migrations.map((m) => m.id);
  if (new Set(ids).size !== ids.length || [...ids].sort().join() !== ids.join()) {
    throw new Error('SQL migrations must have unique ids in ascending order');
  }
  const client = await pool.connect();
  const report: SqlMigrationReport = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      await client.query(BOOTSTRAP);
      const done = new Set(
        (
          await client.query<{ id: string }>('SELECT id FROM system_migrations WHERE id LIKE $1', [
            `${SQL_MIGRATION_PREFIX}%`,
          ])
        ).rows.map((r) => r.id),
      );
      for (const m of migrations) {
        const marker = SQL_MIGRATION_PREFIX + m.id;
        if (done.has(marker)) {
          report.skipped.push(m.id);
          continue;
        }
        try {
          await client.query('BEGIN');
          await client.query(m.sql);
          await client.query(
            'INSERT INTO system_migrations (id, applied_by) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
            [marker, by],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
        report.applied.push(m.id);
      }
    } finally {
      await client
        .query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
  return report;
}
