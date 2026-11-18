import type { RepositoryPorts } from '../../wiring.js';
import type { AdapterContext } from '../registry.js';
import { SystemClock } from '../system/clock.js';
import { PostgresCertificateRepository } from './certificate-repository.js';
import { PostgresEmailQuotaStore } from './email-quota-store.js';
import { PostgresEventRepository } from './event-repository.js';
import { PostgresIdempotencyStore } from './idempotency-store.js';
import { PostgresMigrationStateStore } from './migration-state-store.js';
import { PostgresOrganizationRepository } from './organization-repository.js';
import { createPool } from './pool.js';
import { PostgresTemplateRepository } from './template-repository.js';

export { createPool, poolOptions, withTransaction } from './pool.js';
export { runSqlMigrations } from './migrator.js';
export type { SqlMigrationReport } from './migrator.js';
export { SQL_MIGRATIONS } from './migrations/index.js';
export { keysetCondition, keysetOrderBy, toKeysetPage } from './keyset.js';
export type { KeysetColumn } from './keyset.js';
export { PostgresCertificateRepository } from './certificate-repository.js';
export { PostgresEmailQuotaStore } from './email-quota-store.js';
export { PostgresEventRepository } from './event-repository.js';
export { PostgresIdempotencyStore } from './idempotency-store.js';
export { PostgresMigrationStateStore } from './migration-state-store.js';
export { PostgresOrganizationRepository } from './organization-repository.js';
export { PostgresTemplateRepository } from './template-repository.js';

/** `DB_ADAPTER=postgres`. The schema must already exist (`npm run migrate:postgres`). */
export function createRepositories({ config }: AdapterContext): RepositoryPorts {
  const pool = createPool(config.database, (error) => {
    process.stderr.write(`postgres pool error: ${error.message}\n`);
  });
  const clock = new SystemClock();
  return {
    organizations: new PostgresOrganizationRepository(pool),
    events: new PostgresEventRepository(pool),
    templates: new PostgresTemplateRepository(pool),
    certificates: new PostgresCertificateRepository(pool),
    migrationState: new PostgresMigrationStateStore(pool, clock),
    idempotency: new PostgresIdempotencyStore(pool, clock),
    emailQuota: new PostgresEmailQuotaStore(pool),
    close: () => pool.end(),
  };
}
