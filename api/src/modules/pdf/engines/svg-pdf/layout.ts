import type { FieldConfig } from '../../../templates/index.js';

/** Text measurement for one font; sizes in points. Implemented over the embedded font's metrics. */
export interface FieldFont {
  widthOfString(text: string, size: number): number;
  /** Distance from the top of a line to its baseline. */
  ascent(size: number): number;
}

/** The part of a field config that decides the layout. */
export type LayoutConfig = Pick<
  FieldConfig,
  'width' | 'size' | 'minSize' | 'lineHeight' | 'maxLines' | 'align'
>;

export interface LayoutLine {
  text: string;
  /** Measured width in points. */
  width: number;
  /** Left edge relative to the box, per `align`. */
  offsetX: number;
  /** Baseline relative to the top of the box. */
  baselineY: number;
}

export interface FieldLayout {
  /** Whether the text fits `maxLines` at some size between `size` and `minSize`. */
  fits: boolean;
  /** Font size used: the first that fits, else `minSize`. */
  fontSize: number;
  /** Lines at `fontSize`; when `fits` is false this is the (too long) layout at `minSize`. */
  lines: LayoutLine[];
  requiredLines: number;
}

/** Shrink step in points. */
export const SHRINK_STEP = 0.5;
const EPSILON = 1e-6;

/** Newlines and runs of whitespace become single spaces (text is never interpreted as markup). */
export function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Sizes to try: `size`, `size - 0.5`, ... and always `minSize` last. */
function candidateSizes(size: number, minSize: number): number[] {
  const sizes: number[] = [];
  for (let s = size; s > minSize + EPSILON; s -= SHRINK_STEP) sizes.push(s);
  sizes.push(Math.min(size, minSize));
  return sizes;
}

/** Splits one over-long word into the longest chunks that fit the width (at least one character each). */
function breakWord(word: string, width: number, measure: (t: string) => number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const char of word) {
    if (current !== '' && measure(current + char) > width + EPSILON) {
      chunks.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/**
 * Greedy wrap at spaces. Returns `undefined` when a word is wider than the box and `breakWords` is
 * off (the caller then shrinks further instead of splitting the word).
 */
function wrap(
  words: string[],
  width: number,
  measure: (t: string) => number,
  breakWords: boolean,
): string[] | undefined {
  const lines: string[] = [];
  let current = '';
  const place = (word: string): boolean => {
    if (measure(word) <= width + EPSILON) {
      current = word;
      return true;
    }
    if (!breakWords) return false;
    const chunks = breakWord(word, width, measure);
    current = chunks.pop() ?? '';
    lines.push(...chunks);
    return true;
  };
  for (const word of words) {
    if (current === '') {
      if (!place(word)) return undefined;
      continue;
    }
    const joined = `${current} ${word}`;
    if (measure(joined) <= width + EPSILON) {
      current = joined;
      continue;
    }
    lines.push(current);
    if (!place(word)) return undefined;
  }
  if (current !== '') lines.push(current);
  return lines;
}

/**
 * Lays one field out: the largest size from `size` down to `minSize` (0.5 pt steps) at which the
 * text wraps into at most `maxLines` lines. A single word wider than the box is split by character
 * only at `minSize`. Shared by rendering and `checkFit`, so both always break lines identically.
 * Empty (or whitespace-only) text yields no lines and fits.
 */
export function layoutField(text: string, config: LayoutConfig, font: FieldFont): FieldLayout {
  const words = normalizeText(text)
    .split(' ')
    .filter((w) => w !== '');
  if (words.length === 0) return { fits: true, fontSize: config.size, lines: [], requiredLines: 0 };

  const sizes = candidateSizes(config.size, config.minSize);
  let last: { size: number; lines: string[] } | undefined;
  for (const [index, size] of sizes.entries()) {
    const isMin = index === sizes.length - 1;
    const measure = (t: string): number => font.widthOfString(t, size);
    const lines = wrap(words, config.width, measure, isMin);
    if (lines === undefined) continue;
    last = { size, lines };
    if (lines.length <= config.maxLines) return build(true, size, lines, config, font);
  }
  // Not fitting: `last` is the minSize layout (word breaking guarantees a result there).
  const final = last ?? { size: sizes[sizes.length - 1] ?? config.size, lines: [] };
  return build(false, final.size, final.lines, config, font);
}

function build(
  fits: boolean,
  fontSize: number,
  lines: string[],
  config: LayoutConfig,
  font: FieldFont,
): FieldLayout {
  const pitch = fontSize * config.lineHeight;
  const first = font.ascent(fontSize);
  return {
    fits,
    fontSize,
    requiredLines: lines.length,
    lines: lines.map((text, i) => {
      const width = font.widthOfString(text, fontSize);
      const free = config.width - width;
      const offsetX = config.align === 'left' ? 0 : config.align === 'center' ? free / 2 : free;
      return { text, width, offsetX, baselineY: first + i * pitch };
    }),
  };
}
