import pg, { type Pool, type PoolClient, type PoolConfig } from 'pg';
import type { Config } from '../../config.js';

export type DatabaseConfig = Config['database'];

/**
 * Builds the `pg` pool options from config. Parameterised queries only; the statement timeout is
 * set per connection so a runaway query cannot hold a small VM's pool. TLS: `disable` (local),
 * `require` (encrypted, certificate not verified) or `verify-full` (certificate and host name are
 * checked against `sslCa` or the system roots). A `sslmode` in the URL takes precedence (pg rule).
 */
export function poolOptions(db: DatabaseConfig): PoolConfig {
  if (db.url === undefined) throw new Error('DATABASE_URL is required for DB_ADAPTER=postgres');
  return {
    connectionString: db.url,
    max: db.poolMax,
    connectionTimeoutMillis: db.connectionTimeoutMs,
    idleTimeoutMillis: 30_000,
    statement_timeout: db.statementTimeoutMs,
    application_name: 'certificate-manager-api',
    ssl:
      db.ssl === 'disable'
        ? false
        : db.ssl === 'require'
          ? { rejectUnauthorized: false }
          : { rejectUnauthorized: true, ...(db.sslCa !== undefined && { ca: db.sslCa }) },
  };
}

/** Creates the pool. Idle-client errors (server restart) must not crash the process. */
export function createPool(db: DatabaseConfig, onError?: (error: Error) => void): Pool {
  const pool = new pg.Pool(poolOptions(db));
  pool.on('error', (error) => onError?.(error));
  return pool;
}

/** Runs `work` in a transaction on one connection; rolls back on any error. */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
