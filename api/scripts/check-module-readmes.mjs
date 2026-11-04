// CI guard: every directory under src/modules/* must contain a non-empty README.md that states
// the module's responsibility and public interface (spec §5.2 rule 6, ADR 0012).
// Run: npm run check:module-readmes
// An optional argument overrides the modules directory (used by the architecture tests).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.resolve(process.argv[2] ?? path.join(root, 'src/modules'));

const missing = [];
for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const readme = path.join(modulesDir, entry.name, 'README.md');
  if (!existsSync(readme) || readFileSync(readme, 'utf8').trim() === '') {
    missing.push(entry.name);
  }
}

if (missing.length > 0) {
  console.error(
    'Every module directory needs a non-empty README.md (responsibility, public interface, ' +
      'owned data, non-goals; template: docs/module-readme-template.md). Missing or empty:\n' +
      missing.map((m) => `  ${path.join(modulesDir, m, 'README.md')}`).join('\n'),
  );
  process.exit(1);
}
