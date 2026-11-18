import { randomUUID } from 'node:crypto';
import { ConfigError, loadConfig } from '../../config.js';
import { createPool } from './pool.js';
import { runSqlMigrations } from './migrator.js';

/**
 * `npm run migrate:postgres`: applies the SQL schema migrations and exits. Uses the server's
 * environment; set `MIGRATION_DATABASE_URL` to run DDL with a privileged role while the server
 * itself connects (via `DATABASE_URL`) with a role that has no DDL rights.
 */
try {
  const env: Record<string, string | undefined> = { ...process.env, DB_ADAPTER: 'postgres' };
  const migrationUrl = process.env['MIGRATION_DATABASE_URL'];
  if (migrationUrl) env['DATABASE_URL'] = migrationUrl;
  const config = loadConfig(env);
  const pool = createPool(config.database);
  try {
    const report = await runSqlMigrations(pool, `cli-${randomUUID()}`);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await pool.end();
  }
  process.exit(0);
} catch (err) {
  process.stderr.write(`${err instanceof ConfigError ? err.message : String(err)}\n`);
  process.exit(1);
}
