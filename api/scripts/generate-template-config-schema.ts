// Writes docs/template-config.schema.json from the zod schema (`npm run template-schema:generate`).
// With `--check` it fails instead of writing when the committed file is stale
// (`npm run template-schema:check`; test/unit/template-config-schema.test.ts does the same in CI).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { templateConfigJsonSchema } from '../src/modules/templates/index.js';

const target = fileURLToPath(new URL('../../docs/template-config.schema.json', import.meta.url));

const options = (await prettier.resolveConfig(target)) ?? {};
const text = await prettier.format(JSON.stringify(templateConfigJsonSchema()), {
  ...options,
  filepath: target,
});

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '');
  if (current !== text) {
    process.stderr.write(
      'docs/template-config.schema.json is out of date; run `npm run template-schema:generate -w api`\n',
    );
    process.exit(1);
  }
  process.stdout.write('docs/template-config.schema.json is up to date\n');
} else {
  await writeFile(target, text);
  process.stdout.write(`wrote ${target}\n`);
}
