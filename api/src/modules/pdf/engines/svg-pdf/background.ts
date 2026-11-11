import SVGtoPDF from 'svg-to-pdfkit';
import type { DrawContext, DrawLayer } from './context.js';

/** 1x1 transparent PNG: stands in for any non-embedded `<image>` so no path or URL is ever loaded. */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Template font for an SVG `font-family` list; first family wins, else the first template font. */
function resolveFont(ctx: DrawContext, family: string): string {
  const keys = Object.keys(ctx.config.fonts);
  const wanted = family
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .find((f) => keys.includes(f));
  const key = wanted ?? keys[0];
  return key === undefined ? 'Helvetica' : ctx.fontName(key);
}

/**
 * Draws `background.svg` stretched over the whole page (`preserveAspectRatio="none"`: the aspect
 * ratio was validated at upload), as vector art. Only `data:` images are embedded.
 */
export const drawBackground: DrawLayer = (ctx) => {
  SVGtoPDF(ctx.doc, ctx.assets.background.toString('utf8'), 0, 0, {
    width: ctx.page.width,
    height: ctx.page.height,
    preserveAspectRatio: 'none',
    assumePt: true,
    fontCallback: (family) => resolveFont(ctx, family),
    imageCallback: (link) => (link.startsWith('data:') ? link : BLANK_PNG),
    warningCallback: () => undefined,
  });
};
