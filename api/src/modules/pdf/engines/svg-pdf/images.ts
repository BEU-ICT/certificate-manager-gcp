import type { DrawLayer } from './context.js';

/** Draws `config.images` in order at `x, y, width`; the height follows the aspect ratio (PNG alpha is kept). */
export const drawImages: DrawLayer = (ctx) => {
  for (const image of ctx.config.images ?? []) {
    const data = ctx.assets.images.get(image.file);
    if (data === undefined) continue; // The package validator guarantees presence; stay total.
    ctx.doc.image(data, image.x, image.y, { width: image.width });
  }
};
