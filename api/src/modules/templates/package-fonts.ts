import * as fontkit from 'fontkit';

/** Azerbaijani alphabet, digits and basic punctuation every text font must cover. */
export const REQUIRED_CHARACTERS =
  "AaBbCcÇçDdEeƏəFfGgĞğHhXxIıİiJjKkQqLlMmNnOoÖöPpRrSsŞşTtUuÜüVvYyZz0123456789.,-'’()/";

/** Basic Cyrillic: А-я plus Ё/ё. */
export const CYRILLIC_CHARACTERS = [
  ...Array.from({ length: 0x44f - 0x410 + 1 }, (_, i) => String.fromCodePoint(0x410 + i)),
  'Ё',
  'ё',
].join('');

const SFNT_MAGIC = new Set(['\u0000\u0001\u0000\u0000', 'true', 'OTTO']);

export type FontCheck =
  { ok: false; reason: string } | { ok: true; has: (characters: string) => string[] };

/** Parses a TrueType/OpenType font. `has(chars)` returns the characters that have no glyph. */
export function openFont(bytes: Buffer): FontCheck {
  if (bytes.length < 12) return { ok: false, reason: 'File is too small to be a font' };
  if (!SFNT_MAGIC.has(bytes.toString('latin1', 0, 4))) {
    return { ok: false, reason: 'Not a TrueType/OpenType font (bad signature)' };
  }
  try {
    const font = fontkit.create(bytes);
    if ('fonts' in font) return { ok: false, reason: 'Font collections (.ttc) are not supported' };
    if (font.numGlyphs < 1) return { ok: false, reason: 'Font has no glyphs' };
    return {
      ok: true,
      has: (characters) =>
        [...new Set(characters)].filter(
          (char) => !font.hasGlyphForCodePoint(char.codePointAt(0) ?? 0),
        ),
    };
  } catch {
    return { ok: false, reason: 'Font could not be parsed' };
  }
}
