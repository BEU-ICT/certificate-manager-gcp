// Renders the generated parts of docs/template-authoring(.az).md from the zod config schema, the
// formatter registry and the validator limits, so the guide cannot drift from the code
// (`npm run template-authoring:generate -w api`; test/unit/template-authoring-guide.test.ts checks it).
import { createFormatterRegistry } from '../src/modules/pdf/index.js';
import {
  DEFAULT_FORMATS,
  FIELD_KINDS,
  FORMAT_NAMES,
  KNOWN_FORMATS,
  MAX_IMAGE_DPI,
  MIN_IMAGE_DPI,
  PACKAGE_LIMITS,
  templateConfigJsonSchema,
} from '../src/modules/templates/index.js';

export type GuideLanguage = 'en' | 'az';

export const BEGIN = (name: string): string => `<!-- BEGIN GENERATED: ${name} -->`;
export const END = (name: string): string => `<!-- END GENERATED: ${name} -->`;
export const BLOCKS = ['config-reference', 'field-keys', 'formats', 'limits'] as const;

type Schema = Record<string, unknown>;

const TEXT = {
  en: {
    key: 'Key',
    required: 'Required',
    type: 'Type / allowed values',
    description: 'Description',
    yes: 'yes',
    no: 'no',
    format: 'Format',
    appliesTo: 'Fits field',
    exampleAz: 'Example, locale `az`',
    exampleEn: 'Example, locale `en`',
    defaultFor: 'Default for',
    limit: 'Limit',
    value: 'Value',
    maxFiles: 'Files in a package',
    maxTotal: 'Package size',
    maxBackground: '`background.svg` size',
    maxImage: 'Image size',
    maxImageSide: 'Image side',
    maxFont: 'Font file size',
    dpi: 'Effective logo resolution (warning outside)',
    svgLimits: 'SVG parser limits (depth / elements / attributes per element)',
    px: 'px',
    all: 'all',
    fieldWord: 'fields',
  },
  az: {
    key: 'Açar',
    required: 'Məcburi',
    type: 'Tip / icazə verilən dəyərlər',
    description: 'Təsvir (ingiliscə)',
    yes: 'bəli',
    no: 'xeyr',
    format: 'Format',
    appliesTo: 'Uyğun sahə',
    exampleAz: 'Nümunə, `az` lokalı',
    exampleEn: 'Nümunə, `en` lokalı',
    defaultFor: 'Susmaya görə',
    limit: 'Limit',
    value: 'Dəyər',
    maxFiles: 'Paketdəki fayllar',
    maxTotal: 'Paket ölçüsü',
    maxBackground: '`background.svg` ölçüsü',
    maxImage: 'Şəkil ölçüsü',
    maxImageSide: 'Şəklin tərəfi',
    maxFont: 'Şrift faylının ölçüsü',
    dpi: 'Loqonun effektiv ayırdetməsi (kənarda xəbərdarlıq)',
    svgLimits: 'SVG parser limitləri (dərinlik / element / elementə düşən atribut)',
    px: 'px',
    all: 'hamısı',
    fieldWord: 'sahələr',
  },
} as const;

const asSchema = (value: unknown): Schema => (value ?? {}) as Schema;

function describeType(schema: Schema): string {
  if (schema['const'] !== undefined) return `\`${JSON.stringify(schema['const'])}\``;
  const values = schema['enum'] as unknown[] | undefined;
  if (values) return values.map((v) => `\`${JSON.stringify(v)}\``).join(' \\| ');
  const type = String(schema['type'] ?? 'object');
  const parts: string[] = [];
  if (type === 'number' || type === 'integer') {
    if (schema['minimum'] !== undefined) parts.push(`≥ ${String(schema['minimum'])}`);
    if (schema['exclusiveMinimum'] !== undefined)
      parts.push(`> ${String(schema['exclusiveMinimum'])}`);
    if (schema['maximum'] !== undefined) parts.push(`≤ ${String(schema['maximum'])}`);
  }
  if (type === 'string') {
    if (schema['pattern'] !== undefined)
      parts.push(`pattern \`${String(schema['pattern']).replace(/\\\//g, '/')}\``);
    if (schema['maxLength'] !== undefined) parts.push(`≤ ${String(schema['maxLength'])} chars`);
  }
  if (type === 'array' && schema['maxItems'] !== undefined)
    parts.push(`≤ ${String(schema['maxItems'])} items`);
  return [type, ...parts].join(', ').replace(/\|/g, '\\|');
}

interface Row {
  key: string;
  required: boolean;
  type: string;
  description: string;
}

function collect(prefix: string, schema: Schema, required: boolean, rows: Row[]): void {
  const one = schema['oneOf'] as Schema[] | undefined;
  const node = one && one.length === 1 ? asSchema(one[0]) : schema;
  const properties = node['properties'] as Record<string, Schema> | undefined;
  const items = node['items'] as Schema | undefined;
  const additional = node['additionalProperties'] as Schema | undefined;
  const isObject = node['type'] === 'object';
  const self = prefix === '' ? undefined : prefix;
  if (self !== undefined) {
    rows.push({
      key: self,
      required,
      type: isObject && properties ? 'object' : describeType(node),
      description: String(node['description'] ?? ''),
    });
  }
  if (prefix === 'fields') return; // `fields.<name>` has its own table
  if (properties) {
    const req = new Set((node['required'] as string[] | undefined) ?? []);
    for (const [name, child] of Object.entries(properties)) {
      collect(self ? `${self}.${name}` : name, asSchema(child), req.has(name), rows);
    }
  } else if (items) {
    const props = asSchema(items)['properties'] as Record<string, Schema> | undefined;
    const req = new Set((asSchema(items)['required'] as string[] | undefined) ?? []);
    for (const [name, child] of Object.entries(props ?? {})) {
      collect(`${self}[].${name}`, asSchema(child), req.has(name), rows);
    }
  } else if (additional && isObject) {
    rows.push({
      key: `${self}.<name>`,
      required: false,
      type: describeType(additional),
      description: '',
    });
  }
}

function table(language: GuideLanguage, rows: Row[]): string {
  const t = TEXT[language];
  const lines = [
    `| ${t.key} | ${t.required} | ${t.type} | ${t.description} |`,
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const description = row.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(
      `| \`${row.key}\` | ${row.required ? t.yes : t.no} | ${row.type} | ${description} |`,
    );
  }
  return lines.join('\n');
}

function configReference(language: GuideLanguage): string {
  const schema = templateConfigJsonSchema() as Schema;
  const rows: Row[] = [];
  const required = new Set((schema['required'] as string[] | undefined) ?? []);
  for (const [name, child] of Object.entries(asSchema(schema['properties']))) {
    collect(name, asSchema(child), required.has(name), rows);
  }
  return table(language, rows);
}

function fieldKeys(language: GuideLanguage): string {
  const schema = templateConfigJsonSchema() as Schema;
  const field = asSchema(asSchema(schema['$defs'])['TemplateField']);
  const required = new Set((field['required'] as string[] | undefined) ?? []);
  const rows: Row[] = Object.entries(asSchema(field['properties'])).map(([key, child]) => {
    const node = asSchema(child);
    return {
      key,
      required: required.has(key),
      type: describeType(node),
      description: String(node['description'] ?? ''),
    };
  });
  const names = Object.keys(FIELD_KINDS)
    .map((name) => `\`${name}\``)
    .join(', ');
  return `${language === 'en' ? 'Field names' : 'Sahə adları'}: ${names}.\n\n${table(language, rows)}`;
}

function formats(language: GuideLanguage): string {
  const t = TEXT[language];
  const registry = createFormatterRegistry();
  const sample = {
    text: 'aysel məmmədova-əliyeva',
    date: new Date('2026-11-03T12:00:00.000Z'),
    list: ['TypeScript', 'Cloud Run', 'Firestore'],
  } as const;
  const kinds = {
    text: `${Object.entries(FIELD_KINDS)
      .filter(([, k]) => k === 'text')
      .map(([n]) => n)
      .join(', ')}`,
    date: Object.entries(FIELD_KINDS)
      .filter(([, k]) => k === 'date')
      .map(([n]) => n)
      .join(', '),
    list: Object.entries(FIELD_KINDS)
      .filter(([, k]) => k === 'list')
      .map(([n]) => n)
      .join(', '),
  };
  const lines = [
    `| ${t.format} | ${t.appliesTo} | ${t.defaultFor} | ${t.exampleAz} | ${t.exampleEn} |`,
    '| --- | --- | --- | --- | --- |',
  ];
  for (const name of FORMAT_NAMES) {
    const kind = KNOWN_FORMATS[name];
    const value = sample[kind];
    const render = (locale: string): string =>
      registry.format(name, value, { locale }).replace(/\|/g, '\\|');
    const defaults = DEFAULT_FORMATS[kind] === name ? kinds[kind] : '';
    lines.push(
      `| \`${name}\` | ${kinds[kind]} | ${defaults} | ${render('az')} | ${render('en')} |`,
    );
  }
  return lines.join('\n');
}

const mib = (bytes: number): string => `${bytes / 1024 / 1024} MiB`;

function limits(language: GuideLanguage): string {
  const t = TEXT[language];
  const rows: [string, string][] = [
    [t.maxFiles, String(PACKAGE_LIMITS.maxFiles)],
    [t.maxTotal, mib(PACKAGE_LIMITS.maxTotalBytes)],
    [t.maxBackground, mib(PACKAGE_LIMITS.maxBackgroundBytes)],
    [t.maxImage, mib(PACKAGE_LIMITS.maxImageBytes)],
    [t.maxImageSide, `${PACKAGE_LIMITS.maxImageSidePx} ${t.px}`],
    [t.maxFont, mib(PACKAGE_LIMITS.maxFontBytes)],
    [t.dpi, `${MIN_IMAGE_DPI} – ${MAX_IMAGE_DPI} DPI`],
    [
      t.svgLimits,
      `${PACKAGE_LIMITS.maxSvgDepth} / ${PACKAGE_LIMITS.maxSvgNodes.toLocaleString('en-US')} / ${PACKAGE_LIMITS.maxSvgAttributes}`,
    ],
  ];
  return [
    `| ${t.limit} | ${t.value} |`,
    '| --- | --- |',
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
  ].join('\n');
}

export function renderBlock(name: (typeof BLOCKS)[number], language: GuideLanguage): string {
  switch (name) {
    case 'config-reference':
      return configReference(language);
    case 'field-keys':
      return fieldKeys(language);
    case 'formats':
      return formats(language);
    case 'limits':
      return limits(language);
  }
}

/** Replaces the content between the generated markers; throws when a marker pair is missing. */
export function injectBlocks(markdown: string, language: GuideLanguage): string {
  let result = markdown;
  for (const name of BLOCKS) {
    const begin = BEGIN(name);
    const end = END(name);
    const from = result.indexOf(begin);
    const to = result.indexOf(end);
    if (from < 0 || to < from) throw new Error(`Missing generated block markers for "${name}"`);
    result = `${result.slice(0, from + begin.length)}\n${renderBlock(name, language)}\n${result.slice(to)}`;
  }
  return result;
}
