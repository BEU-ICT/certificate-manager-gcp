import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryRendererRegistry,
  SVG_PDF_ENGINE,
  SvgPdfRenderer,
  type DrawLayer,
} from '../../src/modules/pdf/index.js';
import { PDF_PRODUCER, PDF_TITLE } from '../../src/modules/pdf/engines/svg-pdf/index.js';
import { UnprocessableError } from '../../src/shared/errors.js';
import {
  decodePng,
  differingShare,
  encodePng,
  extractText,
  pageCount,
  readInfo,
  rasterize,
} from '../helpers/pdf-inspect.js';
import { SAMPLE_INPUT, loadSampleAssets, sampleTextLayer } from '../helpers/svg-pdf-fixture.js';

const GOLDEN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/pdf/svg-pdf-sample.png',
);
const latin1 = (pdf: Buffer): string => pdf.toString('latin1');

describe('SvgPdfRenderer', () => {
  const renderer = new SvgPdfRenderer({ fieldsLayer: sampleTextLayer });

  it('registers under the svg-pdf engine name', () => {
    const registry = new InMemoryRendererRegistry();
    registry.register(renderer);
    expect(registry.get(SVG_PDF_ENGINE)).toBe(renderer);
    expect(renderer.engine).toBe('svg-pdf');
  });

  it('renders a one-page A4 landscape PDF with the required metadata', async () => {
    const pdf = await renderer.render(SAMPLE_INPUT, loadSampleAssets());
    const text = latin1(pdf);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(await pageCount(pdf)).toBe(1);
    expect(text).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/);
    const info = await readInfo(pdf);
    expect(info['Title']).toBe(PDF_TITLE);
    expect(info['Producer']).toBe(PDF_PRODUCER);
    expect(info['Author']).toBe('Acme Community');
    // Issued 2026-11-03T23:30Z: the creation date is the issuance date, not the render time.
    expect(info['CreationDate']).toBe('D:20261103233000Z');
  });

  it('honours portrait orientation', async () => {
    const assets = loadSampleAssets({
      config: (c) => ({
        ...c,
        page: { size: 'A4', orientation: 'portrait' },
        fields: {
          ownerName: { ...(c['fields'] as Record<string, object>)['ownerName'], width: 400 },
        },
        qr: { x: 400, y: 700, size: 100 },
      }),
    });
    const pdf = await renderer.render(SAMPLE_INPUT, assets);
    expect(latin1(pdf)).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it('omits Author when there is no organization snapshot (preview)', async () => {
    const preview = { ...SAMPLE_INPUT };
    delete preview.organizationName;
    const pdf = await renderer.render(preview, loadSampleAssets());
    expect((await readInfo(pdf))['Author']).toBeUndefined();
  });

  it('embeds the template font as a subset', async () => {
    const assets = loadSampleAssets();
    const pdf = await renderer.render(SAMPLE_INPUT, assets);
    const text = latin1(pdf);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Fixture-Sans/);
    expect(text).toContain('/FontFile2');
    expect(pdf.length).toBeLessThan((assets.fonts.get('main')?.length ?? 0) + 40_000);
  });

  it('extracts the printed text (golden text)', async () => {
    const pdf = await renderer.render(SAMPLE_INPUT, loadSampleAssets());
    expect((await extractText(pdf)).replace(/\s+/g, ' ').trim()).toBe(
      'Aysel Məmmədova DevFest 2026',
    );
  });

  it('is byte-identical for the same input, including the trailer ID', async () => {
    const a = await renderer.render(SAMPLE_INPUT, loadSampleAssets());
    const b = await renderer.render({ ...SAMPLE_INPUT }, loadSampleAssets());
    expect(b.equals(a)).toBe(true);
    expect(latin1(a)).toMatch(/\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/);
  });

  it('changes the file when the issuance date changes', async () => {
    const a = await renderer.render(SAMPLE_INPUT, loadSampleAssets());
    const b = await renderer.render(
      { ...SAMPLE_INPUT, issuedAt: new Date('2027-01-01T00:00:00Z') },
      loadSampleAssets(),
    );
    expect(b.equals(a)).toBe(false);
  });

  it('survives an invalid issuance date without reading the clock', async () => {
    const input = { ...SAMPLE_INPUT, issuedAt: new Date(Number.NaN) };
    const a = await renderer.render(input, loadSampleAssets());
    const b = await renderer.render(input, loadSampleAssets());
    expect(b.equals(a)).toBe(true);
  });

  it('draws background, images and layers in order', async () => {
    const order: string[] = [];
    const spy =
      (name: string): DrawLayer =>
      () => {
        order.push(name);
      };
    const custom = new SvgPdfRenderer({ fieldsLayer: spy('fields'), qrLayer: spy('qr') });
    await custom.render(SAMPLE_INPUT, loadSampleAssets());
    expect(order).toEqual(['fields', 'qr']);
    const withoutLayers = await new SvgPdfRenderer().render(SAMPLE_INPUT, loadSampleAssets());
    expect(latin1(withoutLayers)).toContain('/Subtype /Image'); // the logo
    expect(await extractText(withoutLayers)).toBe('');
  });

  describe('background SVG security', () => {
    const svgWith = (inner: string): Buffer =>
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 841.89 595.28">${inner}<rect width="50" height="50" fill="#f00"/></svg>`,
      );
    const render = (background: Buffer) =>
      new SvgPdfRenderer().render(SAMPLE_INPUT, { ...loadSampleAssets(), background });
    const imageDimensions = (pdf: Buffer): string[] =>
      [...latin1(pdf).matchAll(/\/Width (\d+)\s+\/Height (\d+)/g)].map((m) => `${m[1]}x${m[2]}`);

    it.each([
      ['http://', '<image href="http://169.254.169.254/x.png" width="10" height="10"/>'],
      ['https:// xlink', '<image xlink:href="https://evil.test/x.png" width="10" height="10"/>'],
      ['file://', '<image href="file:///etc/passwd" width="10" height="10"/>'],
      ['absolute path', '<image href="/etc/passwd" width="10" height="10"/>'],
      ['relative path', '<image href="../../secret.png" width="10" height="10"/>'],
    ])('replaces a %s image reference by a blank 1x1 image', async (_name, inner) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      try {
        const pdf = await render(svgWith(inner));
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(latin1(pdf)).not.toMatch(/passwd|evil\.test|169\.254|secret/);
        expect(imageDimensions(pdf)).toContain('1x1');
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it.each([
      ['<use href="http://evil.test/a.svg#x"/>'],
      ['<use xlink:href="file:///etc/passwd"/>'],
      ['<style>@import url("http://evil.test/a.css");</style>'],
    ])('ignores external references in %s', async (inner) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      try {
        const pdf = await render(svgWith(inner));
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(latin1(pdf)).not.toMatch(/passwd|evil\.test/);
        expect(imageDimensions(pdf)).not.toContain('1x1'); // only the template logo
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('embeds data: images as is', async () => {
      const png = loadSampleAssets().images.get('assets/logo.png') ?? Buffer.alloc(0);
      const href = `data:image/png;base64,${png.toString('base64')}`;
      const pdf = await render(svgWith(`<image href="${href}" width="20" height="20"/>`));
      expect(imageDimensions(pdf).length).toBeGreaterThan(0);
    });
  });

  it('destroys the document when a layer throws', async () => {
    const boom = new SvgPdfRenderer({
      fieldsLayer: (ctx) => {
        ctx.doc.on('close', () => closed.push(true));
        throw new Error('layer failed');
      },
    });
    const closed: boolean[] = [];
    await expect(boom.render(SAMPLE_INPUT, loadSampleAssets())).rejects.toThrow('layer failed');
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toEqual([true]);
  });

  it('destroys the document when a font is missing from the package', async () => {
    const assets = { ...loadSampleAssets(), fonts: new Map<string, Buffer>() };
    await expect(renderer.render(SAMPLE_INPUT, assets)).rejects.toThrow('not loaded');
  });

  it('reports an invalid config as UnprocessableError', async () => {
    const assets = loadSampleAssets({ config: () => ({ engine: 'svg-pdf' }) });
    await expect(renderer.render(SAMPLE_INPUT, assets)).rejects.toBeInstanceOf(UnprocessableError);
  });

  it('checkFit is a no-op until the fields layer lands', () => {
    expect(renderer.checkFit()).toEqual({ fits: true, issues: [] });
  });

  it('matches the golden raster within 0.1% differing pixels', async () => {
    const pdf = await renderer.render(SAMPLE_INPUT, loadSampleAssets());
    const actual = await rasterize(pdf);
    if (process.env['UPDATE_GOLDEN'] === '1') {
      mkdirSync(path.dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, encodePng(actual));
    }
    expect(existsSync(GOLDEN), 'golden missing: run with UPDATE_GOLDEN=1').toBe(true);
    const golden = await decodePng(readFileSync(GOLDEN));
    expect(differingShare(actual, golden)).toBeLessThanOrEqual(0.001);
  });
});
