import { afterAll, expect, it } from 'vitest';
import {
  PostgresCertificateRepository,
  PostgresEmailQuotaStore,
  PostgresEventRepository,
  PostgresIdempotencyStore,
  PostgresMigrationStateStore,
  PostgresOrganizationRepository,
  PostgresTemplateRepository,
} from '../../src/adapters/postgres/index.js';
import { createPool } from '../../src/adapters/postgres/pool.js';
import { runSqlMigrations } from '../../src/adapters/postgres/migrator.js';
import {
  describeCertificateRepositoryContract,
  describeEmailQuotaStoreContract,
  describeEventRepositoryContract,
  describeIdempotencyStoreContract,
  describeMigrationStateStoreContract,
  describeOrganizationRepositoryContract,
  describeTemplateRepositoryContract,
} from '../../src/testing/contracts/index.js';
import { FakeClock } from '../../src/testing/fakes/index.js';
import type { Certificate } from '../../src/shared/domain.js';

// Every contract suite against a real PostgreSQL (`POSTGRES_TEST_URL`); skipped without it.
const url = process.env['POSTGRES_TEST_URL'];

it.skipIf(url !== undefined)('needs POSTGRES_TEST_URL (skipped)', () => undefined);

if (url !== undefined) {
  const pool = createPool({
    url,
    poolMax: 10,
    ssl: 'disable',
    sslCa: undefined,
    statementTimeoutMs: 60_000,
    connectionTimeoutMs: 10_000,
  });
  afterAll(() => pool.end());

  let ready: Promise<unknown> | undefined;
  /** Applies the schema once, then empties every table: each contract case starts from scratch. */
  const fresh = async (): Promise<void> => {
    ready ??= pool
      .query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
      .then(() => runSqlMigrations(pool, 'test'));
    await ready;
    await pool.query(
      `TRUNCATE organizations, events, templates, certificates, uniques, idempotency,
         email_counters, system_migrations`,
    );
  };
  const handle = async <T>(adapter: T) => {
    await fresh();
    return { adapter, cleanup: () => undefined };
  };

  describeOrganizationRepositoryContract('PostgresOrganizationRepository', () =>
    handle(new PostgresOrganizationRepository(pool)),
  );
  describeEventRepositoryContract('PostgresEventRepository', () =>
    handle(new PostgresEventRepository(pool)),
  );
  describeTemplateRepositoryContract('PostgresTemplateRepository', () =>
    handle(new PostgresTemplateRepository(pool)),
  );
  describeCertificateRepositoryContract('PostgresCertificateRepository', () =>
    handle(new PostgresCertificateRepository(pool)),
  );
  describeEmailQuotaStoreContract('PostgresEmailQuotaStore', () =>
    handle(new PostgresEmailQuotaStore(pool)),
  );
  describeMigrationStateStoreContract('PostgresMigrationStateStore', () =>
    handle(new PostgresMigrationStateStore(pool, new FakeClock())),
  );
  describeIdempotencyStoreContract('PostgresIdempotencyStore', async () => {
    await fresh();
    const clock = new FakeClock();
    return {
      adapter: new PostgresIdempotencyStore(pool, clock),
      advance: (ms: number) => clock.advance(ms),
      cleanup: () => undefined,
    };
  });

  it('inserts a batch of 500 certificates in under one second', async () => {
    await fresh();
    const repo = new PostgresCertificateRepository(pool);
    const at = new Date('2026-01-01T00:00:00Z');
    const batch = Array.from({ length: 500 }, (_, i) => ({
      id: `c${String(i).padStart(21, '0')}`,
      organizationId: 'o1',
      eventId: 'e1',
      organizationName: 'Org',
      eventName: 'Event',
      templateId: 'tpl-v1',
      type: 'participant',
      ownerName: `Owner ${String(i)}`,
      subject: 'Subject',
      skills: ['a', 'b'],
      status: 'active',
      issuedAt: at,
      emailStatus: 'pending',
      emailAttempts: 0,
      createdBy: 'admin',
      createdAt: at,
      updatedAt: at,
      schemaVersion: 1,
    })) as unknown as Certificate[];
    const t0 = performance.now();
    await repo.createMany(batch);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(await repo.count({})).toBe(500);
  });
}
