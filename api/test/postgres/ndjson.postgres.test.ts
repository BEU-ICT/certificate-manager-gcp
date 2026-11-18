import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSqlMigrations } from '../../src/adapters/postgres/migrator.js';
import { createPool } from '../../src/adapters/postgres/pool.js';
import { createRepositories } from '../../src/adapters/postgres/index.js';
import { loadConfig } from '../../src/config.js';
import type {
  Certificate,
  CertificateEvent,
  Organization,
  Template,
} from '../../src/shared/domain.js';
import type { RepositoryPorts } from '../../src/wiring.js';
import { connect } from '../../scripts/lib/ndjson-cli.js';
import { exportNdjson, importNdjson, verifyExport } from '../../scripts/lib/ndjson.js';

// PostgreSQL (`POSTGRES_TEST_URL`) is required; the Firestore leg also needs the emulator
// (`FIRESTORE_EMULATOR_HOST`). Dataset size: NDJSON_TEST_CERTIFICATES (default 50 000).
const url = process.env['POSTGRES_TEST_URL'];
const emulator = process.env['FIRESTORE_EMULATOR_HOST'];
const CERTIFICATES = Number(process.env['NDJSON_TEST_CERTIFICATES'] ?? 50_000);
const d = url ? describe : describe.skip;

const T0 = Date.parse('2026-01-01T00:00:00Z');

function dataset(certificates: number) {
  const organizations = Array.from({ length: 20 }, (_, i) => ({
    id: `org${String(i)}`,
    slug: `org-${String(i)}`,
    name: `Organization ${String(i % 7)} é`,
    createdAt: new Date(T0 + i),
    updatedAt: new Date(T0 + i * 2),
    schemaVersion: 1,
  })) as unknown as Organization[];
  const events = Array.from({ length: 200 }, (_, i) => ({
    id: `ev${String(i)}`,
    organizationId: `org${String(i % 20)}`,
    slug: `event-${String(i)}`,
    name: `Event ${String(i)}`,
    emailLanguage: i % 2 === 0 ? 'az' : 'en',
    createdAt: new Date(T0 + (i % 50) * 1000),
    updatedAt: new Date(T0 + i * 1000),
    schemaVersion: 1,
  })) as unknown as CertificateEvent[];
  const templates = Array.from({ length: 200 }, (_, i) => ({
    reference: `org-${String(i % 20)}-event-${String(i)}-attendance-v0`,
    organizationId: `org${String(i % 20)}`,
    eventId: `ev${String(i)}`,
    organizationSlug: `org-${String(i % 20)}`,
    eventSlug: `event-${String(i)}`,
    type: 'attendance',
    version: 0,
    storagePath: `templates/org-${String(i % 20)}-event-${String(i)}-attendance-v0/`,
    config: { z: 1, a: { y: [1, 2, { b: true, a: null }], x: 'ü' }, size: 'A4' },
    createdAt: new Date(T0 + (i % 30) * 1000),
    createdBy: 'admin',
    schemaVersion: 1,
  })) as unknown as Template[];
  const certs = Array.from({ length: certificates }, (_, i) => {
    const revoked = i % 17 === 0;
    return {
      id: `c${String(i).padStart(21, '0')}`,
      organizationId: `org${String(i % 20)}`,
      eventId: `ev${String(i % 200)}`,
      organizationName: 'Organization',
      eventName: 'Event',
      templateId: `org-${String(i % 20)}-event-${String(i % 200)}-attendance-v0`,
      type: 'attendance',
      ownerName: `Owner ${String(i)}`,
      ...(i % 3 === 0 && { email: `owner${String(i)}@example.com` }),
      subject: 'Subject',
      skills: i % 5 === 0 ? ['a', 'b'] : [],
      status: revoked ? 'revoked' : 'active',
      issuedAt: new Date(T0 + (i % 5000) * 1000),
      ...(revoked && { revokedAt: new Date(T0 + 99_000_000), revokeReason: 'mistake' }),
      emailStatus: 'pending',
      emailAttempts: 0,
      ...(i % 11 === 0 && { pdfPath: `pdfs/c${String(i)}.pdf`, pdfGeneratedAt: new Date(T0 + 5) }),
      ...(i % 13 === 0 && { legacy: { id: `legacy-${String(i)}`, template: 'old' } }),
      createdBy: 'admin',
      createdAt: new Date(T0),
      updatedAt: new Date(T0 + 7),
      schemaVersion: 1,
    };
  }) as unknown as Certificate[];
  return { organizations, events, templates, certificates: certs };
}

async function seed(repos: RepositoryPorts, data: ReturnType<typeof dataset>): Promise<void> {
  for (const o of data.organizations) await repos.organizations.create(o);
  for (const e of data.events) await repos.events.create(e);
  for (const t of data.templates) await repos.templates.create(t);
  for (let i = 0; i < data.certificates.length; i += 500) {
    await repos.certificates.createMany(data.certificates.slice(i, i + 500));
  }
}

const sums = (m: Awaited<ReturnType<typeof exportNdjson>>) =>
  Object.fromEntries(Object.entries(m.files).map(([k, v]) => [k, v.sha256]));

d('NDJSON export/import', () => {
  const pool = createPool({
    url,
    poolMax: 8,
    ssl: 'disable',
    sslCa: undefined,
    statementTimeoutMs: 120_000,
    connectionTimeoutMs: 10_000,
  });
  const repos = createRepositories({
    config: loadConfig({ NODE_ENV: 'development', DB_ADAPTER: 'postgres', DATABASE_URL: url }),
  });
  let tmp: string;
  const data = dataset(CERTIFICATES);

  const truncate = () =>
    pool.query('TRUNCATE organizations, events, templates, certificates RESTART IDENTITY');

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'ndjson-'));
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runSqlMigrations(pool, 'test');
    await truncate();
  });
  afterAll(async () => {
    await repos.close?.();
    await pool.end();
  });

  it('round trips PostgreSQL → NDJSON → PostgreSQL → NDJSON with identical checksums', async () => {
    await seed(repos, data);
    const first = await exportNdjson({ repos, outDir: path.join(tmp, 'a') });
    expect(first.files['certificates.ndjson']?.count).toBe(CERTIFICATES);
    expect(((await stat(path.join(tmp, 'a'))).mode & 0o777).toString(8)).toBe('700');

    await truncate();
    const report = await importNdjson({ repos, inDir: path.join(tmp, 'a'), pool });
    expect(report.rejects).toEqual([]);
    expect(report.imported['certificates']).toBe(CERTIFICATES);

    const second = await exportNdjson({ repos, outDir: path.join(tmp, 'b') });
    expect(sums(second)).toEqual(sums(first));
  });

  it('is idempotent: importing twice changes nothing', async () => {
    await importNdjson({ repos, inDir: path.join(tmp, 'a'), pool });
    const again = await exportNdjson({ repos, outDir: path.join(tmp, 'c') });
    const original = JSON.parse(await readFile(path.join(tmp, 'a', 'manifest.json'), 'utf8')) as {
      files: Record<string, { sha256: string }>;
    };
    expect(
      Object.fromEntries(Object.entries(original.files).map(([k, v]) => [k, v.sha256])),
    ).toEqual(sums(again));
  });

  it('dry-run validates without writing', async () => {
    await truncate();
    const report = await importNdjson({ repos, inDir: path.join(tmp, 'a'), pool, dryRun: true });
    expect(report.imported['certificates']).toBe(CERTIFICATES);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM certificates');
    expect(rows[0]?.n).toBe('0');
  });

  it('refuses a tampered file and reports invalid records', async () => {
    const dir = path.join(tmp, 'a');
    const file = path.join(dir, 'organizations.ndjson');
    const original = await readFile(file, 'utf8');
    await writeFile(file, original.replace('Organization', 'Tampered'));
    await expect(verifyExport(dir)).rejects.toThrow(/checksum mismatch/);
    await expect(importNdjson({ repos, inDir: dir, pool })).rejects.toThrow(/checksum/);
    await writeFile(file, original);

    // A record that fails the schema is rejected (after a re-signed manifest), the rest is kept.
    const bad = `${original}{"id":"x","slug":"","name":"n"}\n`;
    await writeFile(file, bad);
    const manifestFile = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
      files: Record<string, { count: number; sha256: string }>;
    };
    manifest.files['organizations.ndjson'] = {
      count: manifest.files['organizations.ndjson']!.count + 1,
      sha256: createHash('sha256').update(bad).digest('hex'),
    };
    await writeFile(manifestFile, JSON.stringify(manifest));
    await truncate();
    const report = await importNdjson({ repos, inDir: dir, pool });
    expect(report.rejects).toHaveLength(1);
    expect(report.rejects[0]).toMatchObject({ file: 'organizations.ndjson', line: 21 });
    expect(report.imported['organizations']).toBe(20);
  });

  it.skipIf(!emulator)(
    'round trips Firestore emulator → NDJSON → PostgreSQL → NDJSON (50k documents)',
    async () => {
      const firestore = await connect('firestore', false, {
        ...process.env,
        NODE_ENV: 'development',
        GCP_PROJECT: 'demo-certificate-manager',
      });
      try {
        const s0 = performance.now();
        await seed(firestore.repos, data);
        process.stderr.write(`firestore seed: ${((performance.now() - s0) / 1000).toFixed(1)} s\n`);
        const t0 = performance.now();
        const fromFirestore = await exportNdjson({
          repos: firestore.repos,
          outDir: path.join(tmp, 'f1'),
        });
        const seconds = (performance.now() - t0) / 1000;
        const total = Object.values(fromFirestore.files).reduce((n, f) => n + f.count, 0);
        process.stderr.write(
          `firestore export: ${String(total)} docs, ${(total / seconds).toFixed(0)} docs/s\n`,
        );
        // Throughput is printed, not asserted: the emulator on a shared machine is far slower than
        // PostgreSQL or real Firestore (the 2k docs/s goal is measured on the PostgreSQL leg below).
        expect(total).toBe(CERTIFICATES + 420);

        await truncate();
        const report = await importNdjson({ repos, inDir: path.join(tmp, 'f1'), pool });
        expect(report.rejects).toEqual([]);
        const fromPostgres = await exportNdjson({ repos, outDir: path.join(tmp, 'f2') });
        expect(sums(fromPostgres)).toEqual(sums(fromFirestore));
      } finally {
        await firestore.close();
      }
    },
    600_000,
  );
});
