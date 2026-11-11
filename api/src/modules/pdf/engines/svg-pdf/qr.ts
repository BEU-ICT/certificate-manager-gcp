import QRCode from 'qrcode';
import { UnprocessableError } from '../../../../shared/errors.js';
import type { TemplateConfig } from '../../../templates/index.js';
import type { FitIssue, RenderInput } from '../../renderer.js';
import type { DrawContext, DrawLayer } from './context.js';

/** Layout error code: the QR modules would print smaller than {@link MIN_MODULE_MM}. */
export const QR_TOO_SMALL = 'QR_TOO_SMALL';

/** Smallest printable module edge (BEU-ICT/certificate-manager#323). */
export const MIN_MODULE_MM = 0.4;
const POINTS_PER_MM = 72 / 25.4;
export const MIN_MODULE_POINTS = MIN_MODULE_MM * POINTS_PER_MM;

/** Quiet zone in modules, per side, included inside the configured `size`. */
export const QUIET_ZONE_MODULES = 4;

/** Module edges snap to multiples of 1/GRID point so neighbours share bit-identical coordinates. */
const GRID = 100;

/** `true` = dark module; row-major `matrix[row][column]`, without quiet zone. */
export function qrMatrix(data: string): boolean[][] {
  // Error correction M, version chosen automatically by the library.
  const { modules } = QRCode.create(data, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(modules.get(r, c) === 1);
    rows.push(row);
  }
  return rows;
}

/** Modules per side including the quiet zone. */
function totalModules(matrix: boolean[][]): number {
  return matrix.length + 2 * QUIET_ZONE_MODULES;
}

/** Module edge in points when `matrix` fills a square of `size` points. */
export function modulePoints(matrix: boolean[][], size: number): number {
  return size / totalModules(matrix);
}

function tooSmallMessage(module: number): string {
  return `${QR_TOO_SMALL}: QR modules would be ${module.toFixed(2)} pt, the minimum is ${MIN_MODULE_POINTS.toFixed(2)} pt (0.4 mm); increase qr.size`;
}

/** Layout findings of the QR code: empty when it prints large enough. */
export function checkQrFit(input: RenderInput, config: TemplateConfig): FitIssue[] {
  const module = modulePoints(qrMatrix(input.publicUrl), config.qr.size);
  return module < MIN_MODULE_POINTS ? [{ field: 'qr', message: tooSmallMessage(module) }] : [];
}

/**
 * Draws the QR code of `RenderInput.publicUrl`: a white square of `qr.size` points at `qr.x, qr.y`
 * (so it scans on tinted artwork) holding the black modules with a 4-module quiet zone inside.
 * Horizontal runs of dark modules are merged, and all rectangles go into one path filled once,
 * on shared snapped edges, so viewers show no anti-aliasing seams between modules.
 * Throws `UnprocessableError(QR_TOO_SMALL)` when the modules would be below 0.4 mm.
 */
export const drawQr: DrawLayer = (ctx: DrawContext) => {
  const { doc, input, config } = ctx;
  const { x, y, size } = config.qr;
  const matrix = qrMatrix(input.publicUrl);
  const module = modulePoints(matrix, size);
  if (module < MIN_MODULE_POINTS) {
    throw new UnprocessableError(QR_TOO_SMALL, 'The QR code is too small to print', [
      { path: 'config.qr.size', message: tooSmallMessage(module), code: QR_TOO_SMALL },
    ]);
  }
  const total = totalModules(matrix);
  const edge = (index: number): number => Math.round((index * size * GRID) / total) / GRID;

  doc.save();
  doc.rect(x, y, size, size).fill('#ffffff');
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      const left = edge(start + QUIET_ZONE_MODULES);
      const top = edge(r + QUIET_ZONE_MODULES);
      doc.rect(
        x + left,
        y + top,
        edge(c + QUIET_ZONE_MODULES) - left,
        edge(r + 1 + QUIET_ZONE_MODULES) - top,
      );
    }
  });
  doc.fill('#000000');
  doc.restore();
};
