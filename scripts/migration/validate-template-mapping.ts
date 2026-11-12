// `npm run migration:validate-template-mapping [-- --production-templates <file>]`
// Checks scripts/migration/template-mapping.json against docs/migration/template-inventory.md and,
// when given the output of `SELECT template, COUNT(*) FROM certificate GROUP BY template`
// (one value per line, a trailing count is ignored), that every production value is mapped or excluded.
// Exit codes: 0 valid (pending entries are listed), 1 problems found, 2 usage.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseProductionTemplates,
  validateTemplateMapping,
  type TemplateMapping,
} from '../../api/scripts/lib/template-mapping.js';

const args = process.argv.slice(2);
const flag = args.indexOf('--production-templates');
const productionFile = flag >= 0 ? args[flag + 1] : undefined;
if (args.length > 0 && (flag < 0 || productionFile === undefined || args.length !== 2)) {
  process.stderr.write('Usage: validate-template-mapping.ts [--production-templates <file>]\n');
  process.exit(2);
}

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
const mapping = JSON.parse(
  readFileSync(here('./template-mapping.json'), 'utf8'),
) as TemplateMapping;
const inventory = readFileSync(here('../../docs/migration/template-inventory.md'), 'utf8');
const production = productionFile
  ? parseProductionTemplates(readFileSync(productionFile, 'utf8'))
  : undefined;

const report = validateTemplateMapping(mapping, inventory, production);
for (const error of report.errors) process.stderr.write(`error ${error}\n`);
for (const name of report.pending) process.stdout.write(`pending ${name}\n`);
if (report.errors.length > 0) process.exit(1);
process.stdout.write(
  `OK: ${Object.keys(mapping.templates).length} templates mapped${
    production
      ? `, ${new Set(production).size} production values covered`
      : ' (no production list given)'
  }\n`,
);
