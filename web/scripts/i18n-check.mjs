// Checks the locale files against each other and against the code:
//  - a key present in one language only,
//  - a key used in code (t('…') / i18nKey="…") but missing from the locale files,
//  - a key in the locale files that no code uses (unused),
// with an allow-list for keys built dynamically (for example `errors:${code}`).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANGUAGES = ['az', 'en'];
const DEFAULT_NS = 'common';
const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Dynamic keys: `ns:prefix*` marks every key of `ns` starting with `prefix` as used. */
export const ALLOW_DYNAMIC = [
  'errors:*',
  'common:certificateTypes.*',
  'common:layout.nav.*', // admin nav items are rendered from a list
];

function walk(dir, filter) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, filter);
    return filter(path) ? [path] : [];
  });
}

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

/** Keys as `ns:key` per language. Plural suffixes are kept here and normalised later. */
function loadLocales(localesDir) {
  const result = {};
  for (const lang of LANGUAGES) {
    const set = new Set();
    const dir = join(localesDir, lang);
    for (const file of walk(dir, (p) => extname(p) === '.json')) {
      const ns = basename(file, '.json');
      const data = JSON.parse(readFileSync(file, 'utf8'));
      for (const key of flatten(data)) set.add(`${ns}:${key}`);
    }
    result[lang] = set;
  }
  return result;
}

const stripPlural = (key) => key.replace(PLURAL, '');

/** Keys referenced in code, qualified as `ns:key`. Template literals with `${` are skipped. */
function collectUsedKeys(srcDir) {
  const used = new Set();
  const files = walk(srcDir, (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.|[\\/]test[\\/]/.test(p));
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    const nsMatch = /useTranslation\(\s*(\[[^\]]*\]|['"][^'"]+['"])/.exec(code);
    const defaultNs = nsMatch
      ? (/['"]([^'"]+)['"]/.exec(nsMatch[1])?.[1] ?? DEFAULT_NS)
      : DEFAULT_NS;
    const patterns = [/\bt\(\s*(['"`])([^'"`]+)\1/g, /\bi18nKey=(?:\{\s*)?(['"`])([^'"`]+)\1/g];
    for (const re of patterns) {
      for (const match of code.matchAll(re)) {
        const key = match[2];
        if (key.includes('${')) continue;
        used.add(key.includes(':') ? key : `${defaultNs}:${key}`);
      }
    }
  }
  return used;
}

function allowed(qualifiedKey, allow) {
  return allow.some((pattern) =>
    pattern.endsWith('*')
      ? qualifiedKey.startsWith(pattern.slice(0, -1))
      : qualifiedKey === pattern,
  );
}

/** @returns {string[]} human readable problems, empty when everything is consistent */
export function checkI18n({ localesDir, srcDir, allow = ALLOW_DYNAMIC }) {
  const problems = [];
  const locales = loadLocales(localesDir);
  const [first, ...others] = LANGUAGES;
  for (const other of others) {
    for (const key of locales[first]) {
      if (!locales[other].has(key))
        problems.push(`missing in ${other}: ${key} (present in ${first})`);
    }
    for (const key of locales[other]) {
      if (!locales[first].has(key))
        problems.push(`missing in ${first}: ${key} (present in ${other})`);
    }
  }

  const used = collectUsedKeys(srcDir);
  const defined = new Set(LANGUAGES.flatMap((lang) => [...locales[lang]].map(stripPlural)));
  for (const key of used) {
    if (!defined.has(key) && !allowed(key, allow))
      problems.push(`used in code but missing: ${key}`);
  }
  for (const key of defined) {
    if (!used.has(key) && !allowed(key, allow)) problems.push(`unused key: ${key}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkI18n({
    localesDir: fileURLToPath(new URL('../src/locales', import.meta.url)),
    srcDir: fileURLToPath(new URL('../src', import.meta.url)),
  });
  if (problems.length > 0) {
    console.error(`i18n:check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log('i18n:check ok');
}
