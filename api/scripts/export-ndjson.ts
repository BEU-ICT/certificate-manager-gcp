// `npm run export:ndjson -w api -- --adapter firestore --out dir/ [--with-files]`
// Streams every collection to NDJSON (one file each) plus manifest.json (count + SHA-256 per file).
// The adapter and storage are configured through the usual environment variables (DB_ADAPTER is
// taken from --adapter; with --with-files STORAGE_ADAPTER selects the source storage). Set
// EXPORT_MANIFEST_KEY to also write manifest.sig (HMAC-SHA256). The output directory is created
// with mode 0700: it contains personal data.
import path from 'node:path';
import { exportNdjson } from './lib/ndjson.js';
import { connect, parseArgs } from './lib/ndjson-cli.js';

try {
  const args = parseArgs(process.argv.slice(2), ['adapter', 'out'], ['with-files']);
  const adapter = args.values.get('adapter');
  const out = args.values.get('out');
  if (adapter === undefined || out === undefined) {
    process.stderr.write(
      'Usage: export-ndjson.ts --adapter <firestore|postgres|memory> --out <dir> [--with-files]\n',
    );
    process.exit(2);
  }
  const withFiles = args.flags.has('with-files');
  const connection = await connect(adapter, withFiles);
  try {
    const started = performance.now();
    const manifest = await exportNdjson({
      repos: connection.repos,
      outDir: path.resolve(out),
      ...(connection.storage !== undefined && { storage: connection.storage }),
      ...(process.env['EXPORT_MANIFEST_KEY'] !== undefined && {
        signKey: process.env['EXPORT_MANIFEST_KEY'],
      }),
      log: { info: (m) => process.stderr.write(`${m}\n`) },
    });
    const total = Object.values(manifest.files).reduce((n, f) => n + f.count, 0);
    const seconds = (performance.now() - started) / 1000;
    process.stderr.write(
      `done: ${String(total)} records in ${seconds.toFixed(1)} s (${(total / seconds).toFixed(0)}/s)\n`,
    );
    process.stdout.write(`${JSON.stringify(manifest.files)}\n`);
  } finally {
    await connection.close();
  }
  process.exit(0);
} catch (error) {
  process.stderr.write(
    `export-ndjson: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
