import jsQRModule from 'jsqr';
import { describe, expect, it } from 'vitest';
import {
  SvgPdfRenderer,
  QR_TOO_SMALL,
  checkQrFit,
  createFields,
  drawQr,
} from '../../src/modules/pdf/index.js';
import {
  MIN_MODULE_POINTS,
  modulePoints,
  qrMatrix,
} from '../../src/modules/pdf/engines/svg-pdf/qr.js';
import { UnprocessableError } from '../../src/shared/errors.js';
import { assertTemplateConfig } from '../../src/modules/templates/index.js';
import { rasterize } from '../helpers/pdf-inspect.js';
import { SAMPLE_INPUT, loadSampleAssets } from '../helpers/svg-pdf-fixture.js';

// jsqr ships CJS typings that NodeNext resolves to the module object; at runtime the default
// import is the decoder function (also under vitest's interop).
const jsQR = jsQRModule as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

const BASE = 'https://certs.example.test/c/';
const ID_22 = 'AbCdEfGhIjKlMnOpQrStUv';
const ID_HEX32 = '0123456789abcdef0123456789abcdef';

const withQr = (qr: Record<string, unknown>) => loadSampleAssets({ config: (c) => ({ ...c, qr }) });

describe('QR drawing', () => {
  const renderer = new SvgPdfRenderer({ qrLayer: drawQr });

  describe.each([
    ['22-char id', ID_22],
    ['32-hex id', ID_HEX32],
  ])('%s', (_name, id) => {
    const url = `${BASE}${id}`;

    it('uses QR version <= 5 at error correction M', () => {
      const n = qrMatrix(url).length;
      expect((n - 17) / 4).toBeLessThanOrEqual(5);
    });

    it.each([72, 300])('decodes the exact URL at %i DPI', async (dpi) => {
      const pdf = await renderer.render(
        { ...SAMPLE_INPUT, publicUrl: url },
        withQr({ x: 690, y: 440, size: 140 }),
      );
      const raster = await rasterize(pdf, dpi / 72);
      const result = jsQR(raster.data, raster.width, raster.height);
      expect(result?.data).toBe(url);
    });
  });

  it('paints a white square behind the modules (quiet zone is white)', async () => {
    const assets = loadSampleAssets({
      config: (c) => ({ ...c, qr: { x: 690, y: 440, size: 140 } }),
    });
    const pdf = await renderer.render({ ...SAMPLE_INPUT, publicUrl: `${BASE}${ID_22}` }, assets);
    const raster = await rasterize(pdf, 2);
    // Quiet-zone corner (inside the square, left of the first module) is white.
    const px = (690 + 2) * 2;
    const py = (440 + 2) * 2;
    const i = (py * raster.width + px) * 4;
    expect([raster.data[i], raster.data[i + 1], raster.data[i + 2]]).toEqual([255, 255, 255]);
  });

  it('keeps the PDF size impact small and rendering fast', async () => {
    const assets = withQr({ x: 690, y: 440, size: 140 });
    const input = { ...SAMPLE_INPUT, publicUrl: `${BASE}${ID_22}` };
    const without = await new SvgPdfRenderer().render(input, assets);
    const started = performance.now();
    const pdf = await renderer.render(input, assets);
    expect(performance.now() - started).toBeLessThan(500);
    expect(pdf.length - without.length).toBeLessThan(5 * 1024);
  });

  it('is deterministic', async () => {
    const assets = withQr({ x: 690, y: 440, size: 140 });
    const a = await renderer.render(SAMPLE_INPUT, assets);
    const b = await renderer.render(SAMPLE_INPUT, assets);
    expect(a.equals(b)).toBe(true);
  });

  describe('QR_TOO_SMALL', () => {
    const url = `${BASE}${ID_22}`;
    const input = { ...SAMPLE_INPUT, publicUrl: url };
    const small = withQr({ x: 690, y: 440, size: 40 });
    const config = assertTemplateConfig(small.template.config).config;

    it('threshold is 0.4 mm', () => {
      expect(MIN_MODULE_POINTS).toBeCloseTo(1.134, 3);
      expect(modulePoints(qrMatrix(url), 40)).toBeLessThan(MIN_MODULE_POINTS);
    });

    it('is reported as a fit issue', () => {
      const issues = checkQrFit(input, config);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.field).toBe('qr');
      expect(issues[0]?.message).toContain(QR_TOO_SMALL);
    });

    it('reports nothing for a large enough code', () => {
      const ok = assertTemplateConfig(withQr({ x: 690, y: 440, size: 140 }).template.config).config;
      expect(checkQrFit(input, ok)).toEqual([]);
    });

    it('render throws 422 QR_TOO_SMALL', async () => {
      const error = await renderer.render(input, small).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableError);
      expect((error as UnprocessableError).code).toBe(QR_TOO_SMALL);
      expect((error as UnprocessableError).details?.[0]?.path).toBe('config.qr.size');
    });
  });
});

describe('checkFit merges the QR layout verdict', () => {
  it('reports QR_TOO_SMALL through SvgPdfRenderer.checkFit next to text misfits', () => {
    const { fieldsLayer, checkFit } = createFields();
    const renderer = new SvgPdfRenderer({ fieldsLayer, qrLayer: drawQr, fitChecker: checkFit });
    const input = { ...SAMPLE_INPUT, publicUrl: `${BASE}${ID_22}` };
    expect(renderer.checkFit(input, withQr({ x: 690, y: 440, size: 140 }))).toEqual({
      fits: true,
      issues: [],
    });
    const result = renderer.checkFit(input, withQr({ x: 690, y: 440, size: 40 }));
    expect(result.fits).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ field: 'qr', reason: QR_TOO_SMALL });
  });
});
