// Offline validator for a template package directory (`npm run template:validate -w api -- <dir>`).
// Reads the directory (no symlinks, no network), parses config.json and runs the same checks as the
// upload flow. Exit code 0: package accepted (warnings allowed); 1: rejected; 2: usage / unreadable.
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CONFIG_FILE,
  PACKAGE_LIMITS,
  parseTemplateConfig,
  validateTemplatePackage,
  type Issue,
} from '../src/modules/templates/index.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const dir = args.find((arg) => !arg.startsWith('--'));
if (dir === undefined || args.some((arg) => arg.startsWith('--') && arg !== '--json')) {
  process.stderr.write('Usage: validate-template.ts <package-dir> [--json]\n');
  process.exit(2);
}

const MAX_ENTRIES = 1000;
const root = path.resolve(dir);

async function walk(current: string, found: { file: string; size: number }[]): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (found.length > MAX_ENTRIES) return;
    const full = path.join(current, entry.name);
    const stat = await lstat(full);
    if (stat.isDirectory()) await walk(full, found);
    else if (stat.isFile())
      found.push({ file: path.relative(root, full).split(path.sep).join('/'), size: stat.size });
    else found.push({ file: path.relative(root, full).split(path.sep).join('/'), size: -1 });
  }
}

const errors: Issue[] = [];
const warnings: Issue[] = [];

const found: { file: string; size: number }[] = [];
try {
  await walk(root, found);
} catch (error) {
  process.stderr.write(
    `Cannot read ${root}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(2);
}

const total = found.reduce((sum, entry) => sum + Math.max(entry.size, 0), 0);
for (const entry of found.filter((item) => item.size < 0)) {
  errors.push({
    code: 'FILE_NOT_REGULAR',
    path: entry.file,
    message: 'Symlinks and special files are not allowed',
  });
}
if (found.length > PACKAGE_LIMITS.maxFiles) {
  errors.push({
    code: 'TOO_MANY_FILES',
    path: '',
    message: `Package has ${String(found.length)} files; at most ${String(PACKAGE_LIMITS.maxFiles)}`,
  });
}
if (total > PACKAGE_LIMITS.maxTotalBytes) {
  errors.push({
    code: 'PACKAGE_TOO_LARGE',
    path: '',
    message: `Package is ${String(total)} bytes; at most ${String(PACKAGE_LIMITS.maxTotalBytes)}`,
  });
}

if (errors.length === 0) {
  const files = new Map<string, Buffer>();
  for (const entry of found) files.set(entry.file, await readFile(path.join(root, entry.file)));
  const configBytes = files.get(CONFIG_FILE);
  let raw: unknown;
  try {
    if (configBytes === undefined) throw new Error('missing');
    raw = JSON.parse(configBytes.toString('utf8'));
  } catch (error) {
    errors.push({
      code: 'CONFIG_UNREADABLE',
      path: CONFIG_FILE,
      message:
        error instanceof Error && error.message === 'missing'
          ? 'config.json is missing'
          : 'config.json is not valid JSON',
    });
  }
  if (errors.length === 0) {
    const parsed = parseTemplateConfig(raw, { files: new Set(files.keys()) });
    warnings.push(...parsed.warnings.map((issue) => ({ ...issue, file: CONFIG_FILE })));
    if (!parsed.ok) {
      errors.push(...parsed.errors.map((issue) => ({ ...issue, file: CONFIG_FILE })));
    } else {
      const report = validateTemplatePackage(files, parsed.config);
      errors.push(...report.errors);
      warnings.push(...report.warnings);
    }
  }
}

if (json) {
  process.stdout.write(
    `${JSON.stringify({ ok: errors.length === 0, errors, warnings }, null, 2)}\n`,
  );
} else {
  const line = (level: string, issue: Issue): string =>
    `${level} ${issue.code} ${issue.path}${issue.file !== undefined && issue.file !== issue.path ? ` (${issue.file})` : ''}: ${issue.message}`;
  for (const issue of errors) process.stdout.write(`${line('error', issue)}\n`);
  for (const issue of warnings) process.stdout.write(`${line('warning', issue)}\n`);
  process.stdout.write(
    errors.length === 0
      ? `OK: ${root} (${String(warnings.length)} warning(s))\n`
      : `REJECTED: ${root} (${String(errors.length)} error(s), ${String(warnings.length)} warning(s))\n`,
  );
}
process.exit(errors.length === 0 ? 0 : 1);
