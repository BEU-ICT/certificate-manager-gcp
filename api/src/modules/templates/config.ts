import { z } from 'zod';
import { UnprocessableError } from '../../shared/errors.js';
import { FORMAT_NAMES, KNOWN_FORMATS, type FormatKind, type FormatName } from './formats.js';
import { MAX_PATH_LENGTH, packagePathProblem } from './paths.js';

/**
 * Template `config` (spec §7 "Config keys", BEU-ICT/certificate-manager-gcp#85).
 *
 * Coordinates and sizes are PDF points with the origin at the top-left corner and y growing
 * downwards (like PDFKit). The schema is strict: unknown properties are rejected at every level.
 * `templateConfigSchema` carries every rule that needs only the config itself; rules that need
 * the uploaded files or only produce warnings live in `parseTemplateConfig`.
 */

/** `fields` keys and the kind of value each one renders (decides which formatters fit). */
export const FIELD_KINDS = {
  ownerName: 'text',
  subject: 'text',
  skills: 'list',
  issuedAt: 'date',
  type: 'text',
} as const satisfies Record<string, FormatKind>;

export type FieldName = keyof typeof FIELD_KINDS;
export const FIELD_NAMES = Object.keys(FIELD_KINDS) as [FieldName, ...FieldName[]];

/** Formatter used when a field has no `format`. */
export const DEFAULT_FORMATS = {
  text: 'text',
  list: 'list-comma',
  date: 'date-long',
} as const satisfies Record<FormatKind, FormatName>;

export const PAGE_SIZES_PT = {
  A4: { width: 595.28, height: 841.89 },
} as const;

export const MAX_IMAGES = 10;
export const MAX_FONTS = 8;
export const MIN_FONT_SIZE = 6;
export const MIN_QR_SIZE = 40;
export const DEFAULT_LINE_HEIGHT = 1.2;
export const DEFAULT_LOCALE = 'az';
/** Boxes may overlap by this much (points, both axes) before the overlap rule applies. */
export const OVERLAP_TOLERANCE_PT = 2;
const MAX_COORDINATE = 10_000;

const FONT_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const PATH_CHARS = '[A-Za-z0-9._-]+';

/** A package path with a required shape, e.g. `assets/<name>.png|jpg|jpeg`. */
function packageFile(shape: RegExp, hint: string): z.ZodString {
  return z
    .string()
    .max(MAX_PATH_LENGTH)
    .superRefine((value, ctx) => {
      const message =
        packagePathProblem(value) ?? (shape.test(value) ? undefined : `Must be ${hint}`);
      if (message !== undefined) ctx.addIssue({ code: 'custom', message });
    })
    .meta({ pattern: shape.source });
}

const coordinate = z.number().min(0).max(MAX_COORDINATE);
const length = z.number().positive().max(MAX_COORDINATE);

const fieldSchema = z
  .strictObject({
    x: coordinate.meta({ description: 'Left edge of the box in points.' }),
    y: coordinate.meta({ description: 'Top edge of the box in points (y grows downwards).' }),
    width: length.meta({ description: 'Box width in points; text wraps inside it.' }),
    font: z.string().meta({ description: 'Key of an entry in `fonts`.' }),
    size: z.number().min(MIN_FONT_SIZE).max(200).meta({ description: 'Font size in points.' }),
    color: z.string().regex(HEX_COLOR, { error: 'Must be a #RRGGBB color' }),
    align: z.enum(['left', 'center', 'right']),
    maxLines: z.int().min(1).max(10),
    format: z
      .enum(FORMAT_NAMES, {
        error: (issue) =>
          `Unknown format${typeof issue.input === 'string' ? ` "${issue.input.slice(0, 40)}"` : ''}; expected one of ${FORMAT_NAMES.join(', ')}`,
      })
      .optional()
      .meta({
        description:
          'Formatter name. Defaults per field: `text` for ownerName, subject and type; `list-comma` for skills; `date-long` for issuedAt. `list-comma` only fits `skills`, `date-*` only `issuedAt`.',
      }),
    minSize: z.number().min(MIN_FONT_SIZE).optional().meta({
      description:
        'Smallest font size the text may shrink to. Default max(6, floor(size * 0.6)) capped at size; must be between 6 and size.',
    }),
    lineHeight: z
      .number()
      .min(1)
      .max(2)
      .optional()
      .meta({ description: `Line height factor, default ${String(DEFAULT_LINE_HEIGHT)}.` }),
    allowOverlap: z.boolean().optional().meta({
      description:
        'Allows this box to overlap another box by more than 2 pt (reported as a warning).',
    }),
  })
  .refine((field) => field.minSize === undefined || field.minSize <= field.size, {
    path: ['minSize'],
    error: 'minSize must not exceed size',
  })
  .meta({ id: 'TemplateField' });

const imageSchema = z.strictObject({
  file: packageFile(
    new RegExp(`^assets/${PATH_CHARS}\\.(png|jpe?g)$`),
    'assets/<name>.png, .jpg or .jpeg',
  ),
  x: coordinate,
  y: coordinate,
  width: length.meta({
    description: 'Printed width in points; the height follows the aspect ratio.',
  }),
});

const qrSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  size: z.number().min(MIN_QR_SIZE).max(MAX_COORDINATE),
});

const pageSchema = z.discriminatedUnion('size', [
  z.strictObject({
    size: z.literal('A4'),
    orientation: z.enum(['landscape', 'portrait']),
  }),
]);

const fieldsSchema = z.strictObject({
  ownerName: fieldSchema,
  subject: fieldSchema.optional(),
  skills: fieldSchema.optional(),
  issuedAt: fieldSchema.optional(),
  type: fieldSchema.optional(),
});

const baseSchema = z.strictObject({
  engine: z.literal('svg-pdf', {
    error: (issue) =>
      issue.input === 'html-chromium'
        ? 'TEMPLATE_INVALID: engine not supported yet'
        : issue.input === undefined
          ? 'Required'
          : 'Must be "svg-pdf"',
  }),
  page: pageSchema,
  locale: z
    .enum(['az', 'en'])
    .optional()
    .meta({ description: 'Date formatting locale, default az.' }),
  background: packageFile(new RegExp(`^(${PATH_CHARS}/)*${PATH_CHARS}\\.svg$`), 'an .svg file'),
  images: z.array(imageSchema).max(MAX_IMAGES).optional(),
  fonts: z
    .record(
      z.string().regex(FONT_NAME, { error: 'Font names match ^[A-Za-z0-9_-]{1,32}$' }),
      packageFile(new RegExp(`^fonts/${PATH_CHARS}\\.ttf$`), 'fonts/<file>.ttf'),
    )
    .refine((fonts) => Object.keys(fonts).length <= MAX_FONTS, {
      error: `At most ${String(MAX_FONTS)} fonts`,
    })
    .meta({ maxProperties: MAX_FONTS }),
  fields: fieldsSchema,
  qr: qrSchema,
});

type BaseConfig = z.output<typeof baseSchema>;
type BaseField = z.output<typeof fieldSchema>;

export interface PageDimensions {
  width: number;
  height: number;
}

export function pageDimensions(page: BaseConfig['page']): PageDimensions {
  const { width, height } = PAGE_SIZES_PT[page.size];
  return page.orientation === 'landscape' ? { width: height, height: width } : { width, height };
}

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  allowOverlap: boolean;
}

function fieldEntries<F>(fields: Partial<Record<FieldName, F | undefined>>): [FieldName, F][] {
  const entries: [FieldName, F][] = [];
  for (const name of FIELD_NAMES) {
    const field = fields[name];
    if (field !== undefined) entries.push([name, field]);
  }
  return entries;
}

type BoxField = Pick<
  BaseField,
  'x' | 'y' | 'width' | 'size' | 'maxLines' | 'lineHeight' | 'allowOverlap'
>;

/** What the overlap check needs; satisfied by both the raw and the resolved config. */
export interface BoxSource {
  fields: Partial<Record<FieldName, BoxField | undefined>>;
  qr: BaseConfig['qr'];
}

function boxes(config: BoxSource): Box[] {
  const result: Box[] = fieldEntries(config.fields).map(([name, field]) => ({
    name: `fields.${name}`,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.maxLines * field.size * (field.lineHeight ?? DEFAULT_LINE_HEIGHT),
    allowOverlap: field.allowOverlap === true,
  }));
  result.push({
    name: 'qr',
    x: config.qr.x,
    y: config.qr.y,
    width: config.qr.size,
    height: config.qr.size,
    allowOverlap: false,
  });
  return result;
}

export interface BoxOverlap {
  /** Config path of the box that comes first / second in the order fields, then `qr`. */
  first: string;
  second: string;
  width: number;
  height: number;
  /** True when one of the two fields sets `allowOverlap: true`. */
  allowed: boolean;
}

/** Pairs of boxes (fields and the QR code) overlapping by more than 2 pt in both axes. */
export function findOverlaps(config: BoxSource): BoxOverlap[] {
  const all = boxes(config);
  const result: BoxOverlap[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a === undefined || b === undefined) continue;
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (width > OVERLAP_TOLERANCE_PT && height > OVERLAP_TOLERANCE_PT) {
        result.push({
          first: a.name,
          second: b.name,
          width,
          height,
          allowed: a.allowOverlap || b.allowOverlap,
        });
      }
    }
  }
  return result;
}

const pt = (value: number): string => `${String(Math.round(value * 100) / 100)} pt`;

/** Cross-field rules that need only the config itself. */
function crossFieldRules(config: BaseConfig, ctx: z.RefinementCtx): void {
  const fail = (path: (string | number)[], code: string, message: string): void => {
    ctx.addIssue({ code: 'custom', path, message, params: { code } });
  };
  const page = pageDimensions(config.page);

  for (const [name, field] of fieldEntries(config.fields)) {
    const base = ['fields', name];
    if (!Object.hasOwn(config.fonts, field.font)) {
      fail(
        [...base, 'font'],
        'FONT_NOT_DEFINED',
        `Font "${field.font.slice(0, 40)}" is not defined in fonts`,
      );
    }
    const kind = KNOWN_FORMATS[field.format ?? DEFAULT_FORMATS[FIELD_KINDS[name]]];
    if (kind !== FIELD_KINDS[name]) {
      fail(
        [...base, 'format'],
        'FORMAT_NOT_APPLICABLE',
        `Format "${String(field.format)}" does not apply to ${name}; ${name} accepts ${formatsFor(FIELD_KINDS[name]).join(', ')}`,
      );
    }
    if (field.x + field.width > page.width) {
      fail(
        [...base, 'width'],
        'OUT_OF_BOUNDS',
        `Box right edge ${pt(field.x + field.width)} exceeds the page width ${pt(page.width)}`,
      );
    }
    const height = field.maxLines * field.size * (field.lineHeight ?? DEFAULT_LINE_HEIGHT);
    if (field.y + height > page.height) {
      fail(
        [...base, 'y'],
        'OUT_OF_BOUNDS',
        `Box bottom edge ${pt(field.y + height)} (maxLines x size x lineHeight = ${pt(height)}) exceeds the page height ${pt(page.height)}`,
      );
    }
  }

  if (config.qr.x + config.qr.size > page.width) {
    fail(
      ['qr', 'size'],
      'OUT_OF_BOUNDS',
      `QR right edge ${pt(config.qr.x + config.qr.size)} exceeds the page width ${pt(page.width)}`,
    );
  }
  if (config.qr.y + config.qr.size > page.height) {
    fail(
      ['qr', 'size'],
      'OUT_OF_BOUNDS',
      `QR bottom edge ${pt(config.qr.y + config.qr.size)} exceeds the page height ${pt(page.height)}`,
    );
  }

  for (const overlap of findOverlaps(config)) {
    if (overlap.allowed) continue;
    fail(
      overlap.second.split('.'),
      'BOXES_OVERLAP',
      `Overlaps ${overlap.first} by ${pt(overlap.width)} x ${pt(overlap.height)}; move one box or set allowOverlap: true on a field`,
    );
  }
}

function formatsFor(kind: FormatKind): string[] {
  return FORMAT_NAMES.filter((name) => KNOWN_FORMATS[name] === kind);
}

export interface FieldConfig extends Omit<BaseField, 'format' | 'minSize' | 'lineHeight'> {
  format: FormatName;
  minSize: number;
  lineHeight: number;
}

export interface TemplateConfig extends Omit<BaseConfig, 'fields' | 'locale' | 'images'> {
  locale: 'az' | 'en';
  images: z.output<typeof imageSchema>[];
  fields: Partial<Record<FieldName, FieldConfig>> & { ownerName: FieldConfig };
}

function resolveField(name: FieldName, field: BaseField): FieldConfig {
  const { format, minSize, lineHeight, ...rest } = field;
  return {
    ...rest,
    format: format ?? DEFAULT_FORMATS[FIELD_KINDS[name]],
    minSize: minSize ?? Math.min(field.size, Math.max(MIN_FONT_SIZE, Math.floor(field.size * 0.6))),
    lineHeight: lineHeight ?? DEFAULT_LINE_HEIGHT,
  };
}

/** Fills the documented defaults so renderers never deal with missing optional keys. */
function resolveDefaults(config: BaseConfig): TemplateConfig {
  const { fields, locale, images, ...rest } = config;
  const resolved: Partial<Record<FieldName, FieldConfig>> = {};
  for (const [name, field] of fieldEntries(config.fields))
    resolved[name] = resolveField(name, field);
  return {
    ...rest,
    locale: locale ?? DEFAULT_LOCALE,
    images: images ?? [],
    fields: { ...resolved, ownerName: resolveField('ownerName', fields.ownerName) },
  };
}

/**
 * The complete schema (structure plus the cross-field rules that need only the config). Parsing
 * yields the stored `TemplateConfig` with defaults applied. Prefer `parseTemplateConfig`, which
 * also checks package files, reports warnings and returns issues as `{ code, path, message }`.
 */
export const templateConfigSchema = baseSchema
  .superRefine(crossFieldRules)
  .transform(resolveDefaults);

/** Author-facing view of the schema (keys as written in `config.json`, defaults not applied). */
export const templateConfigInputSchema = baseSchema;

export interface ConfigIssue {
  /** Stable machine-readable code, e.g. `FONT_NOT_DEFINED`, `unrecognized_keys`, `invalid_type`. */
  code: string;
  /** Config path in the style of the API error details, e.g. `fields.subject.font`, `images[0].file`. */
  path: string;
  message: string;
}

export type TemplateConfigResult =
  | { ok: true; config: TemplateConfig; warnings: ConfigIssue[] }
  | { ok: false; errors: ConfigIssue[]; warnings: ConfigIssue[] };

export interface ParseTemplateConfigOptions {
  /** Paths of all files in the uploaded package; when given, referenced files must be in it. */
  files?: ReadonlySet<string> | readonly string[];
}

export function formatConfigPath(path: readonly PropertyKey[]): string {
  let result = '';
  for (const part of path) {
    if (typeof part === 'number') result += `[${String(part)}]`;
    else result += result === '' ? String(part) : `.${String(part)}`;
  }
  return result;
}

function toIssues(error: z.ZodError): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        issues.push({
          code: 'unrecognized_keys',
          path: formatConfigPath([...issue.path, key.slice(0, 40)]),
          message: 'Unknown property',
        });
      }
      continue;
    }
    if (issue.code === 'invalid_key') {
      issues.push({
        code: 'invalid_key',
        path: formatConfigPath(issue.path),
        message: issue.issues[0]?.message ?? 'Invalid key',
      });
      continue;
    }
    const customCode =
      issue.code === 'custom' && typeof issue.params?.['code'] === 'string'
        ? issue.params['code']
        : undefined;
    const isMissing = issue.code === 'invalid_type' && issue.message.includes('received undefined');
    issues.push({
      code: customCode ?? (isMissing ? 'required' : issue.code),
      path: formatConfigPath(issue.path),
      message: isMissing ? 'Required' : issue.message,
    });
  }
  return issues;
}

function referencedFiles(config: TemplateConfig): { path: string; file: string }[] {
  return [
    { path: 'background', file: config.background },
    ...config.images.map((image, index) => ({
      path: `images[${String(index)}].file`,
      file: image.file,
    })),
    ...Object.entries(config.fonts).map(([name, file]) => ({ path: `fonts.${name}`, file })),
  ];
}

/**
 * Validates an untrusted config object. Never throws for bad input. Errors make the upload fail
 * (`TEMPLATE_INVALID`); warnings are advisory (boxes overlapping on purpose).
 */
export function parseTemplateConfig(
  input: unknown,
  options: ParseTemplateConfigOptions = {},
): TemplateConfigResult {
  const parsed = templateConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: toIssues(parsed.error), warnings: [] };
  }
  const config = parsed.data;
  const errors: ConfigIssue[] = [];
  if (options.files !== undefined) {
    const present = options.files instanceof Set ? options.files : new Set(options.files);
    for (const { path, file } of referencedFiles(config)) {
      if (!present.has(file)) {
        errors.push({
          code: 'FILE_NOT_FOUND',
          path,
          message: `File "${file}" is not part of the package`,
        });
      }
    }
  }
  const warnings: ConfigIssue[] = findOverlaps(config)
    .filter((overlap) => overlap.allowed)
    .map((overlap) => ({
      code: 'BOXES_OVERLAP',
      path: overlap.second,
      message: `Overlaps ${overlap.first} by ${pt(overlap.width)} x ${pt(overlap.height)} (allowed by allowOverlap)`,
    }));
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, config, warnings };
}

/**
 * `parseTemplateConfig` for callers that want the 422 `TEMPLATE_INVALID` error (details carry
 * `{ path, message }` per issue) instead of a result object. Returns the config and its warnings.
 */
export function assertTemplateConfig(
  input: unknown,
  options: ParseTemplateConfigOptions = {},
): { config: TemplateConfig; warnings: ConfigIssue[] } {
  const result = parseTemplateConfig(input, options);
  if (!result.ok) {
    throw new UnprocessableError(
      'TEMPLATE_INVALID',
      'Template config is invalid',
      result.errors.map(({ path, message }) => ({ path, message })),
    );
  }
  return { config: result.config, warnings: result.warnings };
}
