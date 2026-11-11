import * as fontkit from 'fontkit';
import type { FieldFont } from './layout.js';

/** Parsed fonts per package buffer: the template cache hands out the same buffers, so parsing happens once. */
const cache = new WeakMap<Buffer, FieldFont>();

/** Metrics of an embedded TrueType font (advance widths with kerning/ligatures, hhea ascent). */
export function fieldFont(data: Buffer): FieldFont {
  const cached = cache.get(data);
  if (cached) return cached;
  const parsed = fontkit.create(data);
  if ('fonts' in parsed) throw new Error('Font collections are not supported');
  const unitsPerEm = parsed.unitsPerEm;
  const font: FieldFont = {
    widthOfString: (text, size) => (parsed.layout(text).advanceWidth * size) / unitsPerEm,
    ascent: (size) => (parsed.ascent * size) / unitsPerEm,
  };
  cache.set(data, font);
  return font;
}
