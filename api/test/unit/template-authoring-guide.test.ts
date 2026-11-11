import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import { injectBlocks, type GuideLanguage } from '../../scripts/template-authoring-reference.js';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS = path.resolve(API, '../docs');
const GUIDES: [GuideLanguage, string][] = [
  ['en', path.join(DOCS, 'template-authoring.md')],
  ['az', path.join(DOCS, 'template-authoring.az.md')],
];

/** Every source file that can produce a finding shown to a template author. */
const CODE_SOURCES = [
  ...readdirSync(path.join(API, 'src/modules/templates'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(API, 'src/modules/templates', f)),
  path.join(API, 'src/modules/pdf/fit-error.ts'),
  path.join(API, 'src/modules/pdf/registry.ts'),
  path.join(API, 'src/modules/pdf/service.ts'),
  path.join(API, 'src/modules/pdf/engines/svg-pdf/fields.ts'),
  path.join(API, 'src/modules/pdf/engines/svg-pdf/qr.ts'),
];

/** Upper-case string literals in those files that are not finding codes (none today). */
const NOT_CODES = new Set<string>();

function codesInSource(): string[] {
  const found = new Set<string>();
  for (const file of CODE_SOURCES) {
    for (const match of readFileSync(file, 'utf8').matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)) {
      found.add(match[1] as string);
    }
  }
  return [...found].filter((code) => !NOT_CODES.has(code)).sort();
}

/** The troubleshooting section: from its heading to the next `## ` heading. */
function troubleshooting(markdown: string): string {
  const start = markdown.indexOf('## 10.');
  const end = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, end);
}

describe('template authoring guides', () => {
  it('finds the validator codes in the sources', () => {
    expect(codesInSource().length).toBeGreaterThan(30);
  });

  for (const [language, file] of GUIDES) {
    describe(language, () => {
      const markdown = readFileSync(file, 'utf8');

      it('lists every validator, layout and render error/warning code in the troubleshooting table', () => {
        const section = troubleshooting(markdown);
        const missing = codesInSource().filter((code) => !section.includes(`\`${code}\``));
        expect(missing).toEqual([]);
      });

      it('has generated tables that match the schema, formatters and limits (run `npm run template-authoring:generate -w api`)', async () => {
        const options = (await prettier.resolveConfig(file)) ?? {};
        const expected = await prettier.format(injectBlocks(markdown, language), {
          ...options,
          filepath: file,
        });
        expect(markdown).toBe(expected);
      });
    });
  }
});
