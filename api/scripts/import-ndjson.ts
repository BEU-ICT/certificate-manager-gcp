// `npm run import:ndjson -w api -- --adapter postgres --in dir/ [--dry-run] [--with-files] [--rejects file]`
// Verifies manifest.json (counts, SHA-256, optional HMAC with EXPORT_MANIFEST_KEY), validates every
// record against the zod schemas, then upserts by id (idempotent: running twice changes nothing).
// Rejected records are listed on stdout (and written to --rejects as NDJSON); exit code 1 if any.
// With --with-files the objects under files/ are copied into the configured STORAGE_ADAPTER.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '../src/adapters/postgres/pool.js';
import { importNdjson } from './lib/ndjson.js';
import { connect, parseArgs } from './lib/ndjson-cli.js';

try {
  const args = parseArgs(
    process.argv.slice(2),
    ['adapter', 'in', 'rejects'],
    ['dry-run', 'with-files'],
  );
  const adapter = args.values.get('adapter');
  const dir = args.values.get('in');
  if (adapter === undefined || dir === undefined) {
    process.stderr.write(
      'Usage: import-ndjson.ts --adapter <postgres|firestore|memory> --in <dir> [--dry-run] [--with-files] [--rejects <file>]\n',
    );
    process.exit(2);
  }
  const dryRun = args.flags.has('dry-run');
  const connection = await connect(adapter, args.flags.has('with-files'));
  const pool = adapter === 'postgres' ? createPool(connection.config.database) : undefined;
  try {
    const report = await importNdjson({
      repos: connection.repos,
      inDir: path.resolve(dir),
      dryRun,
      ...(pool !== undefined && { pool }),
      ...(connection.storage !== undefined && { storage: connection.storage }),
      ...(process.env['EXPORT_MANIFEST_KEY'] !== undefined && {
        signKey: process.env['EXPORT_MANIFEST_KEY'],
      }),
      log: { info: (m) => process.stderr.write(`${m}\n`) },
    });
    const rejectsFile = args.values.get('rejects');
    if (rejectsFile !== undefined) {
      await writeFile(
        rejectsFile,
        report.rejects.map((r) => JSON.stringify(r)).join('\n') +
          (report.rejects.length ? '\n' : ''),
        {
          mode: 0o600,
        },
      );
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.rejects.length > 0 ? 1 : 0;
  } finally {
    await pool?.end();
    await connection.close();
  }
  process.exit(process.exitCode ?? 0);
} catch (error) {
  process.stderr.write(
    `import-ndjson: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
