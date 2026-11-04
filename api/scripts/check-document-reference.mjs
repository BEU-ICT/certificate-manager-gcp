// CI guard: `DocumentReference` (a Firestore type) must not appear outside src/adapters/**
// (and test/integration/**, which exercises adapters). Relations are plain string IDs.
// Complements the ESLint rule by also catching comments and strings.
// Run: npm run check:document-reference
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowed = ['src/adapters/', 'test/integration/', 'test/architecture/'];
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(full);
    } else if (
      /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) &&
      !allowed.some((a) => rel.startsWith(a))
    ) {
      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\bDocumentReference\b/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
  }
}

for (const dir of ['src', 'test']) walk(path.join(root, dir));

if (offenders.length > 0) {
  console.error(
    'DocumentReference is only allowed under src/adapters/**. Use plain string IDs for relations:\n' +
      offenders.map((o) => `  ${o}`).join('\n'),
  );
  process.exit(1);
}
