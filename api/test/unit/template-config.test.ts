import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import {
  FORMAT_NAMES,
  assertTemplateConfig,
  KNOWN_FORMATS,
  isSafePackagePath,
  pageDimensions,
  parseTemplateConfig,
  templateConfigJsonSchema,
  type ConfigIssue,
} from '../../src/modules/templates/index.js';

type Json = Record<string, unknown>;

function field(overrides: Json = {}): Json {
  return {
    x: 60,
    y: 200,
    width: 400,
    font: 'main',
    size: 24,
    color: '#1A2B3C',
    align: 'center',
    maxLines: 1,
    ...overrides,
  };
}

function landscape(overrides: Json = {}): Json {
  return {
    engine: 'svg-pdf',
    page: { size: 'A4', orientation: 'landscape' },
    background: 'background.svg',
    images: [{ file: 'assets/logo.png', x: 40, y: 30, width: 90 }],
    fonts: { main: 'fonts/main.ttf', bold: 'fonts/bold.ttf' },
    fields: {
      ownerName: field({ y: 220, size: 36, font: 'bold' }),
      subject: field({ y: 290, maxLines: 2 }),
      skills: field({ y: 380, size: 14, format: 'list-comma' }),
      issuedAt: field({ y: 470, width: 200, format: 'date-long' }),
      type: field({ x: 600, y: 60, width: 200, size: 12 }),
    },
    qr: { x: 700, y: 440, size: 100 },
    ...overrides,
  };
}

function without(object: Json, key: string): Json {
  return Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));
}

function portrait(): Json {
  return {
    engine: 'svg-pdf',
    page: { size: 'A4', orientation: 'portrait' },
    locale: 'en',
    background: 'art/portrait.svg',
    fonts: { main: 'fonts/main.ttf' },
    fields: { ownerName: field({ x: 40, y: 400, width: 500 }) },
    qr: { x: 450, y: 700, size: 100 },
  };
}

/** Replaces `fields` entries on the landscape example. */
function withFields(fields: Json): Json {
  const base = landscape();
  return { ...base, fields: { ...(base['fields'] as Json), ...fields } };
}

function errorsOf(input: unknown, files?: string[]): ConfigIssue[] {
  const result = parseTemplateConfig(input, files === undefined ? {} : { files });
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

function expectIssue(issues: ConfigIssue[], path: string, message: RegExp | string): void {
  const match = issues.find((issue) => issue.path === path);
  expect(match, `no issue at "${path}" in ${JSON.stringify(issues)}`).toBeDefined();
  if (typeof message === 'string') expect(match?.message).toBe(message);
  else expect(match?.message).toMatch(message);
}

describe('parseTemplateConfig: valid configs', () => {
  it('accepts an A4 landscape example and fills the documented defaults', () => {
    const result = parseTemplateConfig(landscape());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.config.locale).toBe('az');
    expect(result.config.fields.ownerName).toMatchObject({
      format: 'text',
      minSize: 21,
      lineHeight: 1.2,
    });
    expect(result.config.fields.skills?.minSize).toBe(8);
    expect(result.config.images).toHaveLength(1);
  });

  it('accepts an A4 portrait example without images', () => {
    const result = parseTemplateConfig(portrait());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.locale).toBe('en');
    expect(result.config.images).toEqual([]);
    expect(result.config.fields.subject).toBeUndefined();
  });

  it('applies the default format per field kind', () => {
    const config = landscape({
      fields: {
        ownerName: field({ y: 100 }),
        skills: field({ y: 200 }),
        issuedAt: field({ y: 300 }),
      },
    });
    const result = parseTemplateConfig(config);
    expect(result.ok && result.config.fields.skills?.format).toBe('list-comma');
    expect(result.ok && result.config.fields.issuedAt?.format).toBe('date-long');
  });

  it('keeps explicit minSize and lineHeight and never defaults minSize below 6', () => {
    const result = parseTemplateConfig(
      withFields({
        ownerName: field({ y: 100, size: 8, minSize: 7, lineHeight: 1.5 }),
        subject: field({ y: 300, size: 8 }),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.fields.ownerName).toMatchObject({ minSize: 7, lineHeight: 1.5 });
    expect(result.config.fields.subject?.minSize).toBe(6);
  });

  it('exposes the page dimensions in points', () => {
    expect(pageDimensions({ size: 'A4', orientation: 'landscape' })).toEqual({
      width: 841.89,
      height: 595.28,
    });
    expect(pageDimensions({ size: 'A4', orientation: 'portrait' })).toEqual({
      width: 595.28,
      height: 841.89,
    });
  });
});

describe('parseTemplateConfig: invalid configs report the exact path', () => {
  it('rejects the reserved html-chromium engine', () => {
    const issues = errorsOf(landscape({ engine: 'html-chromium' }));
    expectIssue(issues, 'engine', 'TEMPLATE_INVALID: engine not supported yet');
  });

  it('rejects other engines and a missing engine', () => {
    expectIssue(errorsOf(landscape({ engine: 'pdfkit' })), 'engine', 'Must be "svg-pdf"');
    expectIssue(errorsOf(without(landscape(), 'engine')), 'engine', 'Required');
  });

  it('rejects other page sizes and orientations', () => {
    expect(errorsOf(landscape({ page: { size: 'A3', orientation: 'landscape' } })).length).toBe(1);
    expectIssue(
      errorsOf(landscape({ page: { size: 'A4', orientation: 'square' } })),
      'page.orientation',
      /Invalid option/,
    );
  });

  it('rejects unknown properties at every level', () => {
    const base = landscape();
    const fields = base['fields'] as Json;
    const issues = errorsOf({
      ...base,
      extra: 1,
      qr: { x: 700, y: 440, size: 100, rotate: 90 },
      fields: { ...fields, foo: field(), ownerName: { ...field(), shadow: true } },
    });
    expectIssue(issues, 'extra', 'Unknown property');
    expectIssue(issues, 'qr.rotate', 'Unknown property');
    expectIssue(issues, 'fields.foo', 'Unknown property');
    expectIssue(issues, 'fields.ownerName.shadow', 'Unknown property');
    expect(issues.every((issue) => issue.code === 'unrecognized_keys')).toBe(true);
  });

  it('rejects a bad color', () => {
    const issues = errorsOf(withFields({ subject: field({ y: 300, color: 'red' }) }));
    expectIssue(issues, 'fields.subject.color', 'Must be a #RRGGBB color');
    expectIssue(
      errorsOf(withFields({ subject: field({ y: 300, color: '#FFF' }) })),
      'fields.subject.color',
      'Must be a #RRGGBB color',
    );
  });

  it('rejects a box that leaves the page horizontally', () => {
    const issues = errorsOf(withFields({ subject: field({ x: 500, width: 400, y: 300 }) }));
    expectIssue(
      issues,
      'fields.subject.width',
      /right edge 900 pt exceeds the page width 841\.89 pt/,
    );
  });

  it('rejects a box whose maxLines x size x lineHeight leaves the page vertically', () => {
    // 5 lines x 40 pt x 1.5 = 300 pt starting at y = 400 -> bottom edge 700 > 595.28
    const issues = errorsOf(
      withFields({ subject: field({ y: 400, size: 40, maxLines: 5, lineHeight: 1.5 }) }),
    );
    expectIssue(
      issues,
      'fields.subject.y',
      /bottom edge 700 pt .* exceeds the page height 595\.28 pt/,
    );
  });

  it('checks the portrait page bounds with the portrait size', () => {
    const config = portrait();
    config['qr'] = { x: 500, y: 700, size: 100 };
    expectIssue(
      errorsOf(config),
      'qr.size',
      /QR right edge 600 pt exceeds the page width 595\.28 pt/,
    );
  });

  it('rejects a QR code outside the page and a QR that is too small', () => {
    expectIssue(
      errorsOf(landscape({ qr: { x: 700, y: 540, size: 100 } })),
      'qr.size',
      /QR bottom edge 640 pt exceeds the page height 595\.28 pt/,
    );
    expectIssue(
      errorsOf(landscape({ qr: { x: 700, y: 440, size: 39 } })),
      'qr.size',
      /(>=|at least) ?40/,
    );
  });

  it('rejects a missing qr and a missing ownerName', () => {
    expectIssue(errorsOf(without(landscape(), 'qr')), 'qr', 'Required');
    const base = landscape();
    const fields = without(base['fields'] as Json, 'ownerName');
    expectIssue(errorsOf({ ...base, fields }), 'fields.ownerName', 'Required');
  });

  it('rejects a field whose font is not in fonts', () => {
    const issues = errorsOf(withFields({ subject: field({ y: 300, font: 'missing' }) }));
    expectIssue(issues, 'fields.subject.font', 'Font "missing" is not defined in fonts');
  });

  it('rejects an unknown format and formats that do not fit the field', () => {
    expectIssue(
      errorsOf(withFields({ subject: field({ y: 300, format: 'shout' }) })),
      'fields.subject.format',
      /Unknown format "shout"; expected one of text, uppercase/,
    );
    expectIssue(
      errorsOf(withFields({ subject: field({ y: 300, format: 'list-comma' }) })),
      'fields.subject.format',
      /does not apply to subject/,
    );
    expectIssue(
      errorsOf(withFields({ skills: field({ y: 380, format: 'date-dmy' }) })),
      'fields.skills.format',
      /does not apply to skills; skills accepts list-comma/,
    );
    expectIssue(
      errorsOf(withFields({ issuedAt: field({ y: 470, format: 'uppercase' }) })),
      'fields.issuedAt.format',
      /issuedAt accepts date-dmy, date-iso, date-long/,
    );
  });

  it('rejects minSize above size, minSize below 6 and out-of-range lineHeight', () => {
    expectIssue(
      errorsOf(withFields({ subject: field({ y: 300, size: 20, minSize: 30 }) })),
      'fields.subject.minSize',
      'minSize must not exceed size',
    );
    expect(errorsOf(withFields({ subject: field({ y: 300, minSize: 5 }) }))[0]?.path).toBe(
      'fields.subject.minSize',
    );
    expect(errorsOf(withFields({ subject: field({ y: 300, lineHeight: 2.5 }) }))[0]?.path).toBe(
      'fields.subject.lineHeight',
    );
    expect(errorsOf(withFields({ subject: field({ y: 300, maxLines: 11 }) }))[0]?.path).toBe(
      'fields.subject.maxLines',
    );
    expect(errorsOf(withFields({ subject: field({ y: 300, size: 5 }) }))[0]?.path).toBe(
      'fields.subject.size',
    );
  });

  describe('paths', () => {
    const cases: [string, string][] = [
      ['../secret.svg', 'Path must be normalised'],
      ['a/../b.svg', 'Path must be normalised'],
      ['./background.svg', 'Path must be normalised'],
      ['/etc/background.svg', 'Path must be relative \\(no leading slash\\)'],
      ['dir\\background.svg', 'Path must not contain backslashes'],
      ['dir//background.svg', 'Path may only contain'],
      ['bäckground.svg', 'Path may only contain'],
      ['back ground.svg', 'Path may only contain'],
      [`${'a'.repeat(100)}.svg`, 'String must|Too big|<=100|at most 100'],
      ['background.png', 'Must be an .svg file'],
    ];
    it.each(cases)('rejects background %j', (value, message) => {
      expectIssue(errorsOf(landscape({ background: value })), 'background', new RegExp(message));
    });

    it('rejects traversal in fonts and images', () => {
      expectIssue(
        errorsOf(landscape({ fonts: { main: 'fonts/../../etc/passwd.ttf' } })),
        'fonts.main',
        /normalised/,
      );
      expectIssue(
        errorsOf(landscape({ images: [{ file: 'assets/../x.png', x: 0, y: 0, width: 10 }] })),
        'images[0].file',
        /normalised/,
      );
    });

    it('requires the documented directory and extension per kind', () => {
      expectIssue(
        errorsOf(landscape({ fonts: { main: 'main.ttf' } })),
        'fonts.main',
        'Must be fonts/<file>.ttf',
      );
      expectIssue(
        errorsOf(landscape({ fonts: { main: 'fonts/main.otf' } })),
        'fonts.main',
        'Must be fonts/<file>.ttf',
      );
      expectIssue(
        errorsOf(landscape({ images: [{ file: 'logo.png', x: 0, y: 0, width: 10 }] })),
        'images[0].file',
        'Must be assets/<name>.png, .jpg or .jpeg',
      );
      expectIssue(
        errorsOf(landscape({ images: [{ file: 'assets/a.gif', x: 0, y: 0, width: 10 }] })),
        'images[0].file',
        'Must be assets/<name>.png, .jpg or .jpeg',
      );
    });

    it('accepts .jpg and .jpeg images', () => {
      const images = [
        { file: 'assets/a.jpg', x: 0, y: 0, width: 10 },
        { file: 'assets/b.jpeg', x: 0, y: 0, width: 10 },
      ];
      expect(parseTemplateConfig(landscape({ images })).ok).toBe(true);
    });

    it('exposes the path predicate for the upload flow', () => {
      expect(isSafePackagePath('assets/logo-1.png')).toBe(true);
      expect(isSafePackagePath('assets/../logo.png')).toBe(false);
      expect(isSafePackagePath('')).toBe(false);
    });
  });

  it('limits images to 10 and fonts to 8, and validates font names', () => {
    const images = Array.from({ length: 11 }, (_, i) => ({
      file: `assets/i${String(i)}.png`,
      x: 0,
      y: 0,
      width: 10,
    }));
    expectIssue(errorsOf(landscape({ images })), 'images', /Too big|at most 10/);
    const fonts = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`f${String(i)}`, `fonts/f${String(i)}.ttf`]),
    );
    expectIssue(
      errorsOf(landscape({ fonts: { ...fonts, main: 'fonts/main.ttf' } })),
      'fonts',
      'At most 8 fonts',
    );
    expectIssue(
      errorsOf(landscape({ fonts: { main: 'fonts/main.ttf', 'bad name!': 'fonts/b.ttf' } })),
      'fonts.bad name!',
      'Font names match ^[A-Za-z0-9_-]{1,32}$',
    );
  });

  it('collects several issues in one pass', () => {
    const issues = errorsOf(
      landscape({ engine: 'html-chromium', background: '../x.svg', qr: undefined }),
    );
    expect(issues.map((issue) => issue.path).sort()).toEqual(['background', 'engine', 'qr']);
  });

  it.each([null, 'text', 42, [], undefined])('rejects a non-object config (%j)', (input) => {
    const result = parseTemplateConfig(input);
    expect(result.ok).toBe(false);
  });
});

describe('parseTemplateConfig: overlap rule', () => {
  const overlapping = (extra: Json = {}): Json =>
    withFields({ subject: field({ y: 225, ...extra }) }); // ownerName occupies y 220..263.2

  it('rejects boxes overlapping by more than 2 pt', () => {
    expectIssue(
      errorsOf(overlapping()),
      'fields.subject',
      /Overlaps fields\.ownerName by 400 pt x 28\.8 pt; move one box or set allowOverlap/,
    );
  });

  it('tolerates an overlap of 2 pt or less', () => {
    // ownerName bottom edge: 220 + 36 x 1.2 = 263.2; subject starts at 261.2 -> 2 pt overlap
    expect(parseTemplateConfig(overlapping({ y: 261.2 })).ok).toBe(true);
    expect(parseTemplateConfig(overlapping({ y: 261.0 })).ok).toBe(false);
  });

  it('turns the error into a warning when either field sets allowOverlap', () => {
    for (const config of [
      overlapping({ allowOverlap: true }),
      withFields({
        subject: field({ y: 225 }),
        ownerName: field({ y: 220, size: 36, font: 'bold', allowOverlap: true }),
      }),
    ]) {
      const result = parseTemplateConfig(config);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings).toEqual([
        expect.objectContaining({ code: 'BOXES_OVERLAP', path: 'fields.subject' }),
      ]);
    }
  });

  it('rejects a field covering the QR code', () => {
    const issues = errorsOf(withFields({ type: field({ x: 650, y: 450, width: 150 }) }));
    expectIssue(issues, 'qr', /Overlaps fields\.type/);
  });
});

describe('parseTemplateConfig: package files', () => {
  const files = [
    'background.svg',
    'assets/logo.png',
    'fonts/main.ttf',
    'fonts/bold.ttf',
    'config.json',
  ];

  it('accepts a config whose files are all present', () => {
    expect(parseTemplateConfig(landscape(), { files }).ok).toBe(true);
    expect(parseTemplateConfig(landscape(), { files: new Set(files) }).ok).toBe(true);
  });

  it('reports each missing referenced file at the config path that references it', () => {
    const issues = errorsOf(landscape(), ['config.json', 'fonts/main.ttf']);
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['background', 'FILE_NOT_FOUND'],
      ['images[0].file', 'FILE_NOT_FOUND'],
      ['fonts.bold', 'FILE_NOT_FOUND'],
    ]);
    expectIssue(issues, 'background', 'File "background.svg" is not part of the package');
  });

  it('does not check files when none are given', () => {
    expect(parseTemplateConfig(landscape()).ok).toBe(true);
  });
});

describe('assertTemplateConfig', () => {
  it('returns the config', () => {
    expect(assertTemplateConfig(landscape()).config.locale).toBe('az');
  });

  it('throws a 422 TEMPLATE_INVALID error with the issues as details', () => {
    expect.assertions(3);
    try {
      assertTemplateConfig(landscape({ engine: 'html-chromium' }));
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 422, code: 'TEMPLATE_INVALID' });
      expect((error as { details: unknown }).details).toEqual([
        { path: 'engine', message: 'TEMPLATE_INVALID: engine not supported yet' },
      ]);
      expect((error as Error).message).toBe('Template config is invalid');
    }
  });
});

describe('formats', () => {
  it('lists the names of the formatter registry (BEU-ICT/certificate-manager#321)', () => {
    expect([...FORMAT_NAMES].sort()).toEqual(
      [
        'date-dmy',
        'date-iso',
        'date-long',
        'list-comma',
        'lowercase',
        'text',
        'titlecase',
        'uppercase',
      ].sort(),
    );
    expect(KNOWN_FORMATS['list-comma']).toBe('list');
    expect(KNOWN_FORMATS['date-iso']).toBe('date');
  });
});

describe('docs/template-config.schema.json', () => {
  const committedPath = fileURLToPath(
    new URL('../../../docs/template-config.schema.json', import.meta.url),
  );

  it('matches the schema generated from zod (run `npm run template-schema:generate -w api` after changes)', async () => {
    const committed: unknown = JSON.parse(readFileSync(committedPath, 'utf8'));
    const normalized: unknown = JSON.parse(
      await prettier.format(JSON.stringify(templateConfigJsonSchema()), { parser: 'json' }),
    );
    expect(normalized).toEqual(committed);
  });

  it('is a strict 2020-12 schema', () => {
    const schema = templateConfigJsonSchema();
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['additionalProperties']).toBe(false);
    expect(schema['required']).toEqual(
      expect.arrayContaining(['engine', 'page', 'background', 'fonts', 'fields', 'qr']),
    );
  });
});
