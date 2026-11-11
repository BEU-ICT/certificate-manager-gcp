// Refreshes the generated tables of docs/template-authoring.md and docs/template-authoring.az.md
// (`npm run template-authoring:generate`); with `--check` it fails when they are stale
// (`npm run template-authoring:check`; test/unit/template-authoring-guide.test.ts does the same in CI).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { injectBlocks, type GuideLanguage } from './template-authoring-reference.js';

const check = process.argv.includes('--check');
const guides: [GuideLanguage, string][] = [
  ['en', '../../docs/template-authoring.md'],
  ['az', '../../docs/template-authoring.az.md'],
];

let stale = false;
for (const [language, relative] of guides) {
  const target = fileURLToPath(new URL(relative, import.meta.url));
  const options = (await prettier.resolveConfig(target)) ?? {};
  const current = await readFile(target, 'utf8');
  const next = await prettier.format(injectBlocks(current, language), {
    ...options,
    filepath: target,
  });
  if (next === current) continue;
  if (check) {
    stale = true;
    process.stderr.write(
      `${target} is out of date; run \`npm run template-authoring:generate -w api\`\n`,
    );
  } else {
    await writeFile(target, next);
    process.stdout.write(`wrote ${target}\n`);
  }
}
if (check) {
  if (stale) process.exit(1);
  process.stdout.write('template authoring guides are up to date\n');
}
