import { describe, expect, it } from 'vitest';
import {
  SvgPdfRenderer,
  TEXT_DOES_NOT_FIT,
  createFields,
  type RenderInput,
} from '../../src/modules/pdf/index.js';
import { fieldFont } from '../../src/modules/pdf/engines/svg-pdf/fonts.js';
import {
  layoutField,
  normalizeText,
  type LayoutConfig,
} from '../../src/modules/pdf/engines/svg-pdf/layout.js';
import { assertTemplateConfig } from '../../src/modules/templates/index.js';
import { extractText } from '../helpers/pdf-inspect.js';
import {
  SAMPLE_INPUT,
  loadSampleAssets,
  sampleAssetsWithFields,
} from '../helpers/svg-pdf-fixture.js';

/**
 * The fixture font is monospaced at 0.5 em per glyph (ascent 0.8 em), so a text of n characters
 * is n * size / 2 points wide: widths in these tests are exact.
 */
const font = fieldFont(loadSampleAssets().fonts.get('main') as Buffer);
const BASE: LayoutConfig = {
  width: 640,
  size: 36,
  minSize: 21,
  lineHeight: 1.2,
  maxLines: 1,
  align: 'left',
};
const chars = (n: number): string => 'a'.repeat(n);

describe('layoutField sizing', () => {
  it('fits at full size', () => {
    const layout = layoutField(chars(35), BASE, font); // 35 * 18 = 630
    expect(layout).toMatchObject({ fits: true, fontSize: 36, requiredLines: 1 });
  });

  it('shrinks in 0.5 pt steps until it fits', () => {
    const layout = layoutField(chars(50), BASE, font); // needs size <= 25.6
    expect(layout).toMatchObject({ fits: true, fontSize: 25.5, requiredLines: 1 });
  });

  it('fits only at minSize', () => {
    const layout = layoutField(chars(60), BASE, font); // 60 * 10.5 = 630
    expect(layout).toMatchObject({ fits: true, fontSize: 21 });
  });

  it('is rejected below minSize', () => {
    const layout = layoutField(chars(61), BASE, font); // 640.5 > 640 at 21
    expect(layout.fits).toBe(false);
    expect(layout.fontSize).toBe(21);
    expect(layout.requiredLines).toBeGreaterThan(1);
  });

  it('does not shrink below size when minSize equals size', () => {
    const layout = layoutField(chars(50), { ...BASE, minSize: 36 }, font);
    expect(layout.fits).toBe(false);
    expect(layout.fontSize).toBe(36);
  });

  it('uses extra lines before reporting failure', () => {
    const layout = layoutField(chars(50), { ...BASE, maxLines: 2, minSize: 36 }, font);
    expect(layout).toMatchObject({ fits: true, fontSize: 36, requiredLines: 2 });
  });
});

describe('layoutField wrapping', () => {
  it('normalises newlines and runs of whitespace to single spaces', () => {
    expect(normalizeText('  a\n\nb\t c  ')).toBe('a b c');
    const layout = layoutField('one\ntwo\r\nthree', { ...BASE, width: 1000 }, font);
    expect(layout.lines.map((l) => l.text)).toEqual(['one two three']);
  });

  it('wraps greedily at spaces', () => {
    const layout = layoutField(
      'aaaa bbbb cccc',
      { ...BASE, width: 90, size: 20, minSize: 20, maxLines: 3 },
      font,
    );
    // 10 pt per glyph: "aaaa bbbb" is 90 wide and fits, "cccc" starts line two.
    expect(layout.lines.map((l) => l.text)).toEqual(['aaaa bbbb', 'cccc']);
  });

  it('breaks one over-long word by character only at minSize', () => {
    const word = chars(70); // 70 * 18 = 1260 at 36, 735 at 21
    const layout = layoutField(word, { ...BASE, maxLines: 2 }, font);
    expect(layout.fontSize).toBe(21);
    expect(layout.lines.map((l) => l.text)).toEqual([chars(60), chars(10)]);
    expect(layout.fits).toBe(true);
  });

  it('shrinks a long word to fit instead of splitting it when possible', () => {
    const layout = layoutField(chars(50), { ...BASE, maxLines: 3 }, font);
    expect(layout.lines).toHaveLength(1);
    expect(layout.fontSize).toBe(25.5);
  });

  it('rejects a single very long word that needs too many lines', () => {
    const layout = layoutField(chars(400), BASE, font);
    expect(layout.fits).toBe(false);
    expect(layout.requiredLines).toBe(Math.ceil(400 / 60));
  });

  it('places each character on its own line when the box is narrower than a glyph', () => {
    const layout = layoutField('abc', { ...BASE, width: 1, maxLines: 10 }, font);
    expect(layout.lines.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('yields no lines for empty or blank text', () => {
    expect(layoutField(' \n ', BASE, font)).toMatchObject({
      fits: true,
      lines: [],
      requiredLines: 0,
    });
  });

  it('wraps Azerbaijani, Cyrillic and 120-character names', () => {
    const az = layoutField(
      'Məmmədzadə Həsənəliyevnə Şəfiqə qızı Əliyeva',
      { ...BASE, maxLines: 2 },
      font,
    );
    expect(az.fits).toBe(true); // 45 chars: one line at 28.4 pt or two lines at 36
    const ru = layoutField(
      'Александр Константинович Достоевский-Ивановский',
      { ...BASE, maxLines: 2 },
      font,
    );
    expect(ru.fits).toBe(true);
    const long =
      Array.from({ length: 12 }, () => 'Abcdefghi')
        .join(' ')
        .slice(0, 119) + 'x'; // 120 chars
    expect(long).toHaveLength(120);
    expect(layoutField(long, BASE, font).fits).toBe(false);
    expect(layoutField(long, { ...BASE, maxLines: 3 }, font).fits).toBe(true);
  });
});

describe('layoutField placement', () => {
  it('derives the first baseline from the font ascent and stacks lines by lineHeight', () => {
    const layout = layoutField(
      'aaaa bbbb',
      { ...BASE, width: 50, size: 20, minSize: 20, maxLines: 2 },
      font,
    );
    expect(layout.lines.map((l) => l.baselineY)).toEqual([16, 40]); // 0.8 * 20, then + 20 * 1.2
  });

  it('honours align', () => {
    const at = (align: LayoutConfig['align']): number | undefined =>
      layoutField('aaaa', { ...BASE, width: 100, size: 20, minSize: 20, align }, font).lines[0]
        ?.offsetX;
    expect([at('left'), at('center'), at('right')]).toEqual([0, 30, 60]);
  });
});

describe('checkFit', () => {
  const { fieldsLayer, checkFit } = createFields();
  const renderer = new SvgPdfRenderer({ fieldsLayer, fitChecker: checkFit });
  const withInput = (patch: Partial<RenderInput>): RenderInput => ({ ...SAMPLE_INPUT, ...patch });

  it('accepts the sample certificate', () => {
    expect(renderer.checkFit(SAMPLE_INPUT, loadSampleAssets())).toEqual({ fits: true, issues: [] });
  });

  it('reports the error details of a field that does not fit', () => {
    const result = renderer.checkFit(withInput({ ownerName: chars(61) }), loadSampleAssets());
    expect(result.fits).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      field: 'ownerName',
      reason: TEXT_DOES_NOT_FIT,
      maxLines: 1,
      minSize: 21,
    });
    expect(result.issues[0]?.requiredLines).toBeGreaterThan(1);
    expect(result.issues[0]?.message).toContain('minimum size');
  });

  it('lists all failing fields at once', () => {
    const input = withInput({
      ownerName: chars(200),
      subject: chars(400),
      skills: Array.from({ length: 80 }, (_, i) => `Skill${String(i)}`),
    });
    const assets = sampleAssetsWithFields({
      skills: {
        x: 100,
        y: 400,
        width: 300,
        font: 'main',
        size: 12,
        color: '#000000',
        align: 'left',
        maxLines: 2,
      },
    });
    const result = renderer.checkFit(input, assets);
    expect(result.fits).toBe(false);
    expect(result.issues.map((i) => i.field)).toEqual(['ownerName', 'subject', 'skills']);
  });

  it('skips empty fields without error', () => {
    const result = renderer.checkFit(withInput({ subject: '  ', skills: [] }), loadSampleAssets());
    expect(result.fits).toBe(true);
    const empty = renderer.checkFit(withInput({ ownerName: '' }), loadSampleAssets());
    expect(empty.fits).toBe(true);
  });

  it('wraps a skills list within its box', () => {
    const skills = Array.from({ length: 12 }, (_, i) => `Skill${String(i)}`);
    const wide = sampleAssetsWithFields({
      skills: {
        x: 100,
        y: 400,
        width: 600,
        font: 'main',
        size: 12,
        color: '#000000',
        align: 'left',
        maxLines: 2,
      },
    });
    expect(renderer.checkFit(withInput({ skills }), wide).fits).toBe(true);
    const narrow = sampleAssetsWithFields({
      skills: {
        x: 100,
        y: 400,
        width: 100,
        font: 'main',
        size: 12,
        color: '#000000',
        align: 'left',
        maxLines: 2,
      },
    });
    expect(renderer.checkFit(withInput({ skills }), narrow).fits).toBe(false);
  });

  it('does not load markup: tags are measured as plain characters', () => {
    const result = renderer.checkFit(
      withInput({ ownerName: '<b>' + chars(58) + '</b>' }),
      loadSampleAssets(),
    );
    expect(result.fits).toBe(false); // 65 characters
  });

  it('completes in under 50 ms with warm font caches', () => {
    const assets = loadSampleAssets();
    renderer.checkFit(SAMPLE_INPUT, assets);
    const start = performance.now();
    renderer.checkFit(SAMPLE_INPUT, assets);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('render and checkFit share the layout', () => {
  const { fieldsLayer, checkFit } = createFields();
  const renderer = new SvgPdfRenderer({ fieldsLayer, fitChecker: checkFit });

  it('draws exactly the lines layoutField produces', async () => {
    const input = {
      ...SAMPLE_INPUT,
      subject: 'Introduction to cloud native certificate management systems and operations',
    };
    const assets = loadSampleAssets();
    const { config } = assertTemplateConfig(assets.template.config);
    const f = fieldFont(assets.fonts.get('main') as Buffer);
    const owner = layoutField(input.ownerName, config.fields.ownerName, f);
    const subject = layoutField(input.subject, config.fields.subject as LayoutConfig, f);
    expect(subject.lines.length).toBeGreaterThan(1);

    const text = await extractText(await renderer.render(input, assets));
    const expected = [...owner.lines, ...subject.lines].map((l) => l.text).join(' ');
    expect(text.replace(/\s+/g, ' ').trim()).toBe(expected);
  });

  it('reports the same line count for a misfit that layoutField computes', () => {
    const assets = loadSampleAssets();
    const { config } = assertTemplateConfig(assets.template.config);
    const f = fieldFont(assets.fonts.get('main') as Buffer);
    const ownerName = chars(130);
    const layout = layoutField(ownerName, config.fields.ownerName, f);
    const result = renderer.checkFit({ ...SAMPLE_INPUT, ownerName }, assets);
    expect(result.issues[0]?.requiredLines).toBe(layout.requiredLines);
  });

  it("renders a valid PDF with an unfitting field (rejection is the caller's job)", async () => {
    const pdf = await renderer.render(
      { ...SAMPLE_INPUT, ownerName: chars(130) },
      loadSampleAssets(),
    );
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('throws for a field whose font is missing from the package', () => {
    const assets = { ...loadSampleAssets(), fonts: new Map<string, Buffer>() };
    expect(() => renderer.checkFit(SAMPLE_INPUT, assets)).toThrow('not loaded');
  });
});
