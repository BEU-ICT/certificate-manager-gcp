import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../src/adapters/postgres/pool.js';
import { runSqlMigrations } from '../../src/adapters/postgres/migrator.js';
import { SQL_MIGRATIONS } from '../../src/adapters/postgres/migrations/index.js';
import { keysetCondition, keysetOrderBy } from '../../src/adapters/postgres/keyset.js';

const url = process.env['POSTGRES_TEST_URL'];
const d = url ? describe : describe.skip;

const ROWS = 100_000;
const RESET = 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;';

d('postgres schema', () => {
  const pool = createPool({
    url,
    poolMax: 4,
    ssl: 'disable',
    sslCa: undefined,
    statementTimeoutMs: 120_000,
    connectionTimeoutMs: 10_000,
  });

  beforeAll(async () => {
    await pool.query(RESET);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('creates the schema on an empty database and is idempotent', async () => {
    const first = await runSqlMigrations(pool, 'test');
    expect(first.applied).toEqual(['001-initial-schema']);
    const second = await runSqlMigrations(pool, 'test');
    expect(second).toEqual({ applied: [], skipped: ['001-initial-schema'] });
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'certificates',
      'email_counters',
      'events',
      'idempotency',
      'organizations',
      'system_migrations',
      'templates',
      'uniques',
    ]);
  });

  it('re-running the raw migration SQL against an existing schema changes nothing', async () => {
    for (const m of SQL_MIGRATIONS) await pool.query(m.sql);
  });

  it('survives concurrent migrators', async () => {
    await pool.query(RESET);
    const reports = await Promise.all(
      [1, 2, 3].map((n) => runSqlMigrations(pool, `p${String(n)}`)),
    );
    expect(reports.flatMap((r) => r.applied)).toEqual(['001-initial-schema']);
  });

  it('enforces the unique constraints that replace reservation documents', async () => {
    const t = new Date();
    await pool.query(
      `INSERT INTO organizations (id, slug, name, created_at, updated_at, schema_version)
       VALUES ('o1', 'acme', 'Acme', $1, $1, 1)`,
      [t],
    );
    await expect(
      pool.query(
        `INSERT INTO organizations (id, slug, name, created_at, updated_at, schema_version)
         VALUES ('o2', 'acme', 'Other', $1, $1, 1)`,
        [t],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const ev = (id: string) =>
      pool.query(
        `INSERT INTO events (id, organization_id, slug, name, email_language, created_at, updated_at, schema_version)
         VALUES ($1, 'o1', 'conf', 'Conf', 'az', $2, $2, 1)`,
        [id, t],
      );
    await ev('e1');
    await expect(ev('e2')).rejects.toMatchObject({ code: '23505' });
  });

  it('uses indexes for all 63 filter combinations on 100k rows (p95 < 50 ms)', async () => {
    await pool.query(
      `INSERT INTO certificates (id, organization_id, event_id, organization_name, event_name,
         template_id, type, owner_name, subject, skills, status, issued_at, email_status,
         created_by, created_at, updated_at, schema_version)
       SELECT lpad(i::text, 22, 'a'), 'org' || (i % 20), 'ev' || (i % 200), 'Org', 'Event',
         'tpl-v1', (ARRAY['participant','speaker','winner','organizer','volunteer'])[1 + i % 5],
         'Owner ' || i, 'Subject', ARRAY['a','b'],
         CASE WHEN i % 50 = 0 THEN 'revoked' ELSE 'active' END,
         timestamptz '2026-01-01' + (i * interval '7 seconds'),
         (ARRAY['pending','sent','failed','skipped'])[1 + i % 4],
         'admin', now(), now(), 1
       FROM generate_series(1, ${String(ROWS)}) AS i`,
    );
    await pool.query('ANALYZE certificates');

    const filters: [string, string | null][] = [
      ['organization_id', 'org7'],
      ['event_id', 'ev7'],
      ['type', 'speaker'],
      ['status', 'active'],
      ['email_status', 'sent'],
      ['issued_at', null],
    ];
    const order = [
      { column: 'issued_at', direction: 'desc' },
      { column: 'id', direction: 'desc' },
    ] as const;
    const timings: number[] = [];
    for (let mask = 1; mask < 64; mask++) {
      const where: string[] = [];
      const params: unknown[] = [];
      filters.forEach(([col, val], i) => {
        if ((mask & (1 << i)) === 0) return;
        if (col === 'issued_at') {
          params.push(new Date('2026-01-03'), new Date('2026-01-08'));
          where.push(
            `issued_at >= $${String(params.length - 1)} AND issued_at < $${String(params.length)}`,
          );
        } else {
          params.push(val);
          where.push(`${col} = $${String(params.length)}`);
        }
      });
      // Second page: keyset cursor after an arbitrary row.
      const cur = keysetCondition(
        order,
        [new Date('2026-01-06'), 'z'.repeat(22)],
        params.length + 1,
      );
      const sql = `SELECT * FROM certificates WHERE ${[...where, cur.sql].join(' AND ')} ${keysetOrderBy(order)} LIMIT 26`;
      const all = [...params, ...cur.params];
      const plan = JSON.stringify((await pool.query(`EXPLAIN (FORMAT JSON) ${sql}`, all)).rows[0]);
      expect(plan, `mask ${String(mask)}`).not.toContain('"Seq Scan"');
      await pool.query(sql, all); // warm
      const t0 = performance.now();
      await pool.query(sql, all);
      timings.push(performance.now() - t0);
    }
    expect(timings).toHaveLength(63);
    timings.sort((a, b) => a - b);
    expect(timings[Math.ceil(timings.length * 0.95) - 1] as number).toBeLessThan(50);
  });
});
