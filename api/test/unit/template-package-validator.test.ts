import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_LIMITS,
  parseTemplateConfig,
  validateTemplatePackage,
  type Issue,
  type TemplateConfig,
} from '../../src/modules/templates/index.js';
import {
  GOOD_CONFIG,
  buildFont,
  buildJpegHeader,
  buildPng,
  fontCharacters,
  svgDocument,
} from '../fixtures/templates/build.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/templates');
const apiRoot = path.join(root, '../../..');

function readTree(dir: string, prefix = ''): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      for (const [file, bytes] of readTree(full, `${prefix}${name}/`)) files.set(file, bytes);
    } else files.set(`${prefix}${name}`, readFileSync(full));
  }
  return files;
}

const malicious = (name: string): Buffer => readFileSync(path.join(root, 'malicious', name));

function goodPackage(): { files: Map<string, Buffer>; raw: Record<string, unknown> } {
  const files = readTree(path.join(root, 'good'));
  const raw = JSON.parse(files.get('config.json')?.toString('utf8') ?? '') as Record<
    string,
    unknown
  >;
  return { files, raw };
}

function parse(raw: unknown, files: Map<string, Buffer>): TemplateConfig {
  const result = parseTemplateConfig(raw, { files: new Set(files.keys()) });
  if (!result.ok) throw new Error(`fixture config invalid: ${JSON.stringify(result.errors)}`);
  return result.config;
}

function validate(
  mutate: (files: Map<string, Buffer>, raw: Record<string, unknown>) => void = () => undefined,
) {
  const { files, raw } = goodPackage();
  mutate(files, raw);
  return validateTemplatePackage(files, parse(raw, files));
}

/**
 * Fastest CPU time (user + system, ms) of a few runs. CPU time instead of wall-clock time keeps
 * the timing assertions meaningful when CI or a shared machine is busy with other processes.
 */
function bestOf(runs: number, fn: () => void): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const before = process.cpuUsage();
    fn();
    const used = process.cpuUsage(before);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  return best;
}

const codes = (issues: Issue[]): string[] => issues.map((issue) => issue.code);

describe('template package validator: good package', () => {
  it('passes with at most one warning', () => {
    const report = validate();
    expect(report.errors).toEqual([]);
    expect(report.warnings.length).toBeLessThanOrEqual(1);
  });

  it('validates in under 300 ms', () => {
    const { files, raw } = goodPackage();
    const config = parse(raw, files);
    expect(bestOf(3, () => validateTemplatePackage(files, config))).toBeLessThan(300);
  });

  it('keeps the committed config in sync with the generator', () => {
    expect(goodPackage().raw).toEqual(GOOD_CONFIG);
  });

  it('handles a 10 MB package in under 1 s', () => {
    const { files, raw } = goodPackage();
    // A heavy but realistic background: a few thousand elements with long path data.
    const data = 'M0 0 L10 10 L20 0 '.repeat(250);
    const element = `<path d="${data}Z" fill="#336699" stroke="#000" stroke-width="1"/>\n`;
    const svg = svgDocument(element.repeat(Math.floor((4.9 * 1024 * 1024) / element.length)));
    expect(svg.length).toBeLessThan(PACKAGE_LIMITS.maxBackgroundBytes);
    files.set('background.svg', Buffer.from(svg));
    const font = files.get('fonts/main.ttf') ?? Buffer.alloc(0);
    files.set('fonts/main.ttf', Buffer.concat([font, Buffer.alloc(2.2 * 1024 * 1024)]));
    files.set(
      'assets/big.png',
      Buffer.concat([buildPng(400, 200), Buffer.alloc(1.8 * 1024 * 1024)]),
    );
    raw['images'] = [{ file: 'assets/big.png', x: 100, y: 60, width: 100 }];
    files.set(
      'assets/logo.png',
      Buffer.concat([buildPng(800, 400), Buffer.alloc(0.5 * 1024 * 1024)]),
    );
    expect([...files.values()].reduce((n, b) => n + b.length, 0)).toBeGreaterThan(9 * 1024 * 1024);
    const config = parse(raw, files);
    expect(validateTemplatePackage(files, config).errors).toEqual([]);
    expect(bestOf(3, () => validateTemplatePackage(files, config))).toBeLessThan(1000);
  });
});

describe('template package validator: SVG', () => {
  const rejected: [string, string][] = [
    ['xxe.svg', 'SVG_DOCTYPE'],
    ['billion-laughs.svg', 'SVG_DOCTYPE'],
    ['script.svg', 'SVG_SCRIPT'],
    ['onload.svg', 'SVG_EVENT_HANDLER'],
    ['external-href.svg', 'SVG_EXTERNAL_REFERENCE'],
    ['foreign-object.svg', 'SVG_FOREIGN_OBJECT'],
    ['css-import.svg', 'SVG_CSS_IMPORT'],
    ['wrong-root.svg', 'SVG_ROOT_NOT_SVG'],
  ];
  it.each(rejected)('rejects %s with %s', (file, code) => {
    const report = validate((files) => files.set('background.svg', malicious(file)));
    expect(codes(report.errors)).toContain(code);
    expect(report.errors.find((issue) => issue.code === code)).toMatchObject({
      path: 'background',
      file: 'background.svg',
    });
  });

  const inline = (body: string, options?: Parameters<typeof svgDocument>[1]) =>
    validate((files) => files.set('background.svg', Buffer.from(svgDocument(body, options))));

  it('rejects further external reference shapes', () => {
    for (const body of [
      '<use href="other.svg#a"/>',
      '<use xlink:href="http://example.com/a.svg#a" xmlns:xlink="http://www.w3.org/1999/xlink"/>',
      '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>',
      '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>',
      '<rect fill="url(http://example.com/x)" width="1" height="1"/>',
      '<style>.a{fill:url("https://example.com/x")}</style>',
      '<rect style="fill:url(//example.com/x)" width="1" height="1"/>',
      '<rect width="1" height="1" ONCLICK="x()"/>',
    ]) {
      expect(codes(inline(body).errors), body).toContain(
        body.includes('ONCLICK') ? 'SVG_EVENT_HANDLER' : 'SVG_EXTERNAL_REFERENCE',
      );
    }
  });

  it('rejects CSS escapes, xml-stylesheet and SMIL that target external URLs', () => {
    const cases: [string, string][] = [
      ['<style>.a{fill:\\75rl(http://evil/x)}</style>', 'SVG_CSS_ESCAPE'],
      ['<style>@\\69mport "http://evil/a.css";</style>', 'SVG_CSS_ESCAPE'],
      ['<rect style="fill:\\75rl(http://evil/x)" width="1" height="1"/>', 'SVG_CSS_ESCAPE'],
      ['<style>.a{fill:url(http://evil/x)</style>', 'SVG_EXTERNAL_REFERENCE'],
      ['<style>.a{fill:UrL( http://evil/x )}</style>', 'SVG_EXTERNAL_REFERENCE'],
      ['<set attributeName="href" to="http://evil/x"/>', 'SVG_EXTERNAL_REFERENCE'],
      ['<animate attributeName="fill" values="url(http://evil/x);red"/>', 'SVG_EXTERNAL_REFERENCE'],
    ];
    for (const [body, code] of cases) expect(codes(inline(body).errors), body).toContain(code);
    const pi = inline('<rect width="1" height="1"/>', {
      prolog: '<?xml-stylesheet href="http://evil/a.css"?>\n',
    });
    expect(codes(pi.errors)).toContain('SVG_PROCESSING_INSTRUCTION');
    expect(inline('<animate attributeName="opacity" from="0" to="1"/>').errors).toEqual([]);
  });

  it('is strict about XML syntax and decodes character references before checking', () => {
    const bad = [
      '<rect width=1/>',
      '<rect width="1" width="2"/>',
      '<rect width="1"height="1"/>',
      '<rect width="a<b"/>',
      '<a:rect/>',
      '<!-- unterminated',
      '<rect>&#x110000;</rect>',
      '<rect>&unknown;</rect>',
    ];
    for (const body of bad) expect(codes(inline(body).errors), body).toContain('SVG_NOT_XML');
    const hidden = inline('<a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a>');
    expect(codes(hidden.errors)).toContain('SVG_EXTERNAL_REFERENCE');
    const escaped = inline('<rect style="fill:&#92;75rl(http://evil/x)" width="1" height="1"/>');
    expect(codes(escaped.errors)).toContain('SVG_CSS_ESCAPE');
    expect(
      inline('<svg:g xmlns:svg="http://www.w3.org/2000/svg"><!-- ok --><![CDATA[x]]></svg:g>')
        .errors,
    ).toEqual([]);
  });

  it('decodes character data before checking <style> (also with a prefix), CDATA stays verbatim', () => {
    const wrap = (inner: string): string =>
      `<style>${inner}</style><s:style xmlns:s="http://www.w3.org/2000/svg">${inner}</s:style>`;
    const cases: [string, string][] = [
      ['&#64;import "http://evil/a.css";', 'SVG_CSS_IMPORT'],
      ['.a{fill:&#117;rl(http://evil/x)}', 'SVG_EXTERNAL_REFERENCE'],
      ['.a{fill:&#92;75rl(http://evil/x)}', 'SVG_CSS_ESCAPE'],
      ['<![CDATA[@import "http://evil/a.css";]]>', 'SVG_CSS_IMPORT'],
      ['.a{background:image-set("http://evil/x" 1x)}', 'SVG_EXTERNAL_REFERENCE'],
      ['.a{background:-webkit-image-set(url(#a) 1x)}', 'SVG_EXTERNAL_REFERENCE'],
      ['.a{background:cross-fade(#a, #b)}', 'SVG_EXTERNAL_REFERENCE'],
    ];
    for (const [css, code] of cases) expect(codes(inline(wrap(css)).errors), css).toContain(code);
    expect(
      codes(inline('<rect style="background:image(#a)" width="1" height="1"/>').errors),
    ).toContain('SVG_EXTERNAL_REFERENCE');
  });

  it('folds case without changing string length (dotted capital I)', () => {
    const body = `<rect style="fill:${'İ'.repeat(14)}url(http://evil/x)#a" width="1" height="1"/>`;
    expect(codes(inline(body).errors)).toContain('SVG_EXTERNAL_REFERENCE');
  });

  it('rejects malformed comments, non-UTF-8 declarations, xml:base and a double BOM', () => {
    for (const body of ['<!-->', '<!--->', '<!-- a -- b -->', '<!-- a --->']) {
      expect(codes(inline(body).errors), body).toContain('SVG_NOT_XML');
    }
    expect(inline('<!-- fine -->').errors).toEqual([]);
    expect(inline('<!---->').errors).toEqual([]);
    const declared = (encoding: string) =>
      validate((files) =>
        files.set(
          'background.svg',
          Buffer.from(svgDocument('').replace('encoding="UTF-8"', `encoding="${encoding}"`)),
        ),
      );
    expect(codes(declared('ISO-8859-1').errors)).toContain('SVG_NOT_XML');
    expect(declared('utf-8').errors).toEqual([]);
    expect(codes(inline('<rect xml:base="http://evil/" width="1" height="1"/>').errors)).toContain(
      'SVG_EXTERNAL_REFERENCE',
    );
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const doubled = validate((files) =>
      files.set('background.svg', Buffer.concat([bom, bom, Buffer.from(svgDocument(''))])),
    );
    expect(codes(doubled.errors)).toContain('SVG_NOT_XML');
  });

  it('bounds the work for entity-heavy and attribute-heavy input', () => {
    const entities = inline('&amp;'.repeat(1_000_000));
    expect(entities.errors).toEqual([]);
    const tag = `<g ${Array.from({ length: 100 }, (_, i) => `a${String(i)}="1"`).join(' ')}/>`;
    const ms = bestOf(1, () => inline(tag.repeat(5_000)));
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  it('scans pathological url( input in linear time', () => {
    for (const [size, limit] of [
      [20_000, 100],
      [1_000_000, 3000],
    ] as const) {
      const body = `<style>${'url('.repeat(size)}</style>`;
      let report: ReturnType<typeof inline> | undefined;
      const ms = bestOf(1, () => {
        report = inline(body);
      });
      expect(ms).toBeLessThan(limit);
      expect(codes(report?.errors ?? [])).toContain('SVG_EXTERNAL_REFERENCE');
    }
    const ms = bestOf(1, () => inline(`<style>${'url(#a) '.repeat(500_000)}</style>`));
    expect(ms).toBeLessThan(3000);
  }, 30_000);

  it('accepts in-document references and inline PNG/JPEG data', () => {
    const report = inline(
      '<defs><path id="p" d="M0 0"/></defs><use href="#p"/><rect fill="url(#p)" width="1" height="1"/>' +
        '<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>' +
        '<style>.a{fill:url(#p)}</style>',
    );
    expect(report.errors).toEqual([]);
  });

  it('rejects an entity reference and malformed XML without expanding anything', () => {
    expect(codes(inline('<text>&xxe;</text>').errors)).toContain('SVG_NOT_XML');
    expect(codes(inline('<g><rect></g>').errors)).toContain('SVG_NOT_XML');
    const report = validate((files) =>
      files.set('background.svg', Buffer.from([0xff, 0xfe, 0x00])),
    );
    expect(codes(report.errors)).toContain('SVG_NOT_XML');
  });

  it('bounds nesting depth and element count', () => {
    const deep =
      '<g>'.repeat(PACKAGE_LIMITS.maxSvgDepth + 5) + '</g>'.repeat(PACKAGE_LIMITS.maxSvgDepth + 5);
    expect(codes(inline(deep).errors)).toEqual(['SVG_TOO_COMPLEX']);
    const wide = '<g/>'.repeat(PACKAGE_LIMITS.maxSvgNodes + 1);
    expect(codes(inline(wide).errors)).toEqual(['SVG_TOO_COMPLEX']);
  });

  it('checks the viewBox against the page aspect ratio', () => {
    expect(codes(inline('', { viewBox: null }).errors)).toContain('SVG_NO_VIEWBOX');
    expect(codes(inline('', { viewBox: '0 0 0 10' }).errors)).toContain('SVG_NO_VIEWBOX');
    // A4 landscape is 1.41421; scale the height to be 0.5% / 2% / 5% off.
    const box = (percent: number): string => `0 0 841.89 ${String(595.28 * (1 + percent / 100))}`;
    expect(inline('', { viewBox: box(0.5) })).toEqual({ errors: [], warnings: [] });
    const warned = inline('', { viewBox: box(2) });
    expect(warned.errors).toEqual([]);
    expect(codes(warned.warnings)).toEqual(['SVG_VIEWBOX_ASPECT']);
    expect(codes(inline('', { viewBox: box(5) }).errors)).toEqual(['SVG_VIEWBOX_MISMATCH']);
  });

  it('warns about <text> elements', () => {
    const report = validate((files) => files.set('background.svg', malicious('text-element.svg')));
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toEqual(['SVG_TEXT_ELEMENTS']);
  });

  it('rejects a background over 5 MB without parsing it', () => {
    const report = validate((files) =>
      files.set('background.svg', Buffer.alloc(PACKAGE_LIMITS.maxBackgroundBytes + 1, 0x20)),
    );
    expect(codes(report.errors)).toEqual(['FILE_TOO_LARGE']);
  });
});

describe('template package validator: images', () => {
  it('rejects an image over 4000 px per side', () => {
    const report = validate((files) => files.set('assets/logo.png', malicious('huge-image.png')));
    expect(codes(report.errors)).toEqual(['IMAGE_TOO_LARGE_DIMENSIONS']);
    expect(report.errors[0]).toMatchObject({ path: 'images[0].file', file: 'assets/logo.png' });
  });

  it('rejects a PNG renamed to .jpg', () => {
    const report = validate((files, raw) => {
      files.delete('assets/logo.png');
      files.set('assets/logo.jpg', malicious('png-renamed.jpg'));
      raw['images'] = [{ file: 'assets/logo.jpg', x: 320, y: 60, width: 200 }];
    });
    expect(codes(report.errors)).toEqual(['IMAGE_TYPE_MISMATCH']);
  });

  it('rejects an image over 2 MB and content that is no image', () => {
    const big = validate((files) =>
      files.set(
        'assets/logo.png',
        Buffer.concat([buildPng(800, 400), Buffer.alloc(2 * 1024 * 1024)]),
      ),
    );
    expect(codes(big.errors)).toEqual(['FILE_TOO_LARGE']);
    const junk = validate((files) => files.set('assets/logo.png', Buffer.from('<svg/>')));
    expect(codes(junk.errors)).toEqual(['IMAGE_CORRUPT']);
    const truncated = validate((files) =>
      files.set('assets/logo.png', buildPng(10, 10).subarray(0, 14)),
    );
    expect(codes(truncated.errors)).toEqual(['IMAGE_CORRUPT']);
  });

  it('reads JPEG dimensions and warns about resolution at the printed width', () => {
    const jpeg = (width: number, height: number, printed: number) =>
      validate((files, raw) => {
        files.delete('assets/logo.png');
        files.set('assets/photo.jpeg', buildJpegHeader(width, height));
        raw['images'] = [{ file: 'assets/photo.jpeg', x: 320, y: 60, width: printed }];
      });
    expect(jpeg(800, 400, 200)).toMatchObject({ errors: [], warnings: [] }); // 288 DPI
    expect(codes(jpeg(400, 200, 200).warnings)).toEqual(['IMAGE_LOW_RESOLUTION']); // 144 DPI
    expect(codes(jpeg(3000, 1500, 200).warnings)).toEqual(['IMAGE_HIGH_RESOLUTION']); // 1080 DPI
    expect(codes(jpeg(4001, 10, 400).errors)).toEqual(['IMAGE_TOO_LARGE_DIMENSIONS']);
    expect(codes(jpeg(0, 10, 400).errors)).toEqual(['IMAGE_CORRUPT']);
  });
});

describe('template package validator: fonts', () => {
  it('rejects a zero-byte font and garbage', () => {
    for (const name of ['empty.ttf', 'garbage.ttf']) {
      const report = validate((files) => files.set('fonts/main.ttf', malicious(name)));
      expect(codes(report.errors), name).toEqual(['FONT_INVALID']);
      expect(report.errors[0]).toMatchObject({ path: 'fonts.main', file: 'fonts/main.ttf' });
    }
  });

  it('rejects a corrupted but correctly signed font and a font over 3 MB', () => {
    const font = buildFont(fontCharacters());
    const corrupt = validate((files) => files.set('fonts/main.ttf', font.subarray(0, 60)));
    expect(codes(corrupt.errors)).toEqual(['FONT_INVALID']);
    const big = validate((files) =>
      files.set('fonts/main.ttf', Buffer.concat([font, Buffer.alloc(PACKAGE_LIMITS.maxFontBytes)])),
    );
    expect(codes(big.errors)).toEqual(['FILE_TOO_LARGE']);
  });

  it('rejects a font without the schwa and names the missing characters', () => {
    const report = validate((files) => files.set('fonts/main.ttf', malicious('no-schwa.ttf')));
    expect(codes(report.errors)).toEqual(['FONT_MISSING_GLYPHS']);
    expect(report.errors[0]?.message).toMatch(/Ə.*ə|ə.*Ə/);
  });

  it('warns, but does not fail, when Cyrillic is missing', () => {
    const report = validate((files) => files.set('fonts/main.ttf', malicious('no-cyrillic.ttf')));
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toEqual(['FONT_NO_CYRILLIC']);
  });

  it('checks coverage only for fonts used by ownerName and subject', () => {
    const report = validate((files, raw) => {
      files.set('fonts/extra.ttf', malicious('no-schwa.ttf'));
      (raw['fonts'] as Record<string, string>)['extra'] = 'fonts/extra.ttf';
    });
    expect(report.errors).toEqual([]);
    const used = validate((files, raw) => {
      files.set('fonts/extra.ttf', malicious('no-schwa.ttf'));
      (raw['fonts'] as Record<string, string>)['extra'] = 'fonts/extra.ttf';
      (raw['fields'] as Record<string, { font: string }>)['subject'] = {
        ...(GOOD_CONFIG.fields.subject as { font: string }),
        font: 'extra',
      };
    });
    expect(codes(used.errors)).toEqual(['FONT_MISSING_GLYPHS']);
    expect(used.errors[0]?.path).toBe('fonts.extra');
  });

  it('requires every punctuation character, digits and the apostrophes', () => {
    const report = validate((files) =>
      files.set('fonts/main.ttf', buildFont(fontCharacters().replace(/[0’/]/g, ''))),
    );
    expect(report.errors[0]?.message).toContain('0');
    expect(report.errors[0]?.message).toContain('’');
  });
});

describe('template package validator: package and file names', () => {
  it('rejects more than 30 files and more than 10 MB in total', () => {
    const many = validate((files) => {
      for (let i = 0; i < 30; i++) files.set(`assets/extra${String(i)}.png`, buildPng(1, 1));
    });
    expect(codes(many.errors)).toEqual(['TOO_MANY_FILES']);
    const heavy = validate((files) => {
      for (let i = 0; i < 6; i++)
        files.set(`assets/pad${String(i)}.bin`, Buffer.alloc(2 * 1024 * 1024));
    });
    expect(codes(heavy.errors)).toEqual(['PACKAGE_TOO_LARGE']);
  });

  it('rejects names that differ only in case', () => {
    const report = validate((files) => files.set('Assets/Logo.PNG', buildPng(1, 1)));
    expect(codes(report.errors)).toEqual(['FILENAME_DUPLICATE_CASE']);
    expect(report.errors[0]?.message).toContain('assets/logo.png');
  });

  it('rejects control characters and unsafe names', () => {
    const control = validate((files) => files.set('assets/bad\nname.png', buildPng(1, 1)));
    expect(codes(control.errors)).toEqual(['FILENAME_CONTROL_CHARACTERS']);
    expect(control.errors[0]?.path).not.toContain('\n');
    const unsafe = validate((files) => files.set('../escape.png', buildPng(1, 1)));
    expect(codes(unsafe.errors)).toEqual(['FILENAME_INVALID']);
  });

  it('reports referenced files that are missing and warns about unreferenced ones', () => {
    const { files, raw } = goodPackage();
    files.set('notes.txt', Buffer.from('hi'));
    files.delete('assets/logo.png');
    const parsed = parseTemplateConfig(raw);
    if (!parsed.ok) throw new Error('fixture config invalid');
    const report = validateTemplatePackage(files, parsed.config);
    expect(report.errors).toEqual([
      expect.objectContaining({ code: 'FILE_NOT_FOUND', path: 'images[0].file' }),
    ]);
    expect(codes(report.warnings)).toEqual(['UNREFERENCED_FILE']);
  });

  it('is pure: the same input gives the same report and does not mutate the files', () => {
    const { files, raw } = goodPackage();
    const config = parse(raw, files);
    const before = new Map([...files].map(([k, v]) => [k, Buffer.from(v)]));
    expect(validateTemplatePackage(files, config)).toEqual(validateTemplatePackage(files, config));
    for (const [name, bytes] of before) expect(files.get(name)?.equals(bytes)).toBe(true);
  });
});

describe('validate-template CLI', { timeout: 60_000 }, () => {
  const run = async (...args: string[]) => {
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/validate-template.ts', ...args],
        { cwd: apiRoot, env: { ...process.env, NODE_OPTIONS: '' } },
      );
      return { code: 0, stdout };
    } catch (error) {
      const failure = error as { code: number; stdout: string };
      return { code: failure.code, stdout: failure.stdout };
    }
  };

  it('accepts the good package offline', async () => {
    const result = await run(path.join(root, 'good'));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('OK:');
  });

  it('rejects a directory that is not a package and prints JSON on request', async () => {
    const result = await run(path.join(root, 'malicious'), '--json');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      errors: [{ code: 'CONFIG_UNREADABLE' }],
    });
  });

  it('exits 2 on bad usage', async () => {
    expect((await run()).code).toBe(2);
  });
});
