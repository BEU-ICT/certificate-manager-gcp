import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface Raster {
  width: number;
  height: number;
  /** RGBA bytes. */
  data: Uint8ClampedArray;
}

async function open(pdf: Buffer) {
  // pdfjs transfers the array, so hand it a copy.
  return getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, verbosity: 0 }).promise;
}

/** Text of page 1 as pdfjs extracts it (items joined by single spaces). */
export async function extractText(pdf: Buffer): Promise<string> {
  const doc = await open(pdf);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

export async function pageCount(pdf: Buffer): Promise<number> {
  return (await open(pdf)).numPages;
}

/** Rasterises page 1 at `scale` pixels per point. */
export async function rasterize(pdf: Buffer, scale = 1): Promise<Raster> {
  const doc = await open(pdf);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: image.data };
}

/** Share of pixels whose channels differ by more than `channelTolerance` (0..1). */
export function differingShare(a: Raster, b: Raster, channelTolerance = 16): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0)) > channelTolerance) {
        different++;
        break;
      }
    }
  }
  return different / (a.width * a.height);
}

export function encodePng(raster: Raster): Buffer {
  const canvas = createCanvas(raster.width, raster.height);
  const context = canvas.getContext('2d');
  context.putImageData(context.createImageData(raster.width, raster.height), 0, 0);
  const image = context.getImageData(0, 0, raster.width, raster.height);
  image.data.set(raster.data);
  context.putImageData(image, 0, 0);
  return canvas.toBuffer('image/png');
}

export async function decodePng(png: Buffer): Promise<Raster> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

/** The document information dictionary as pdfjs reads it. */
export async function readInfo(pdf: Buffer): Promise<Record<string, unknown>> {
  const { info } = await (await open(pdf)).getMetadata();
  return info as Record<string, unknown>;
}
