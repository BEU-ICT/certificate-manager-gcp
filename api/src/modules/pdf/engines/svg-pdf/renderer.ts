import { assertTemplateConfig, pageDimensions } from '../../../templates/index.js';
import type { FitResult, RenderAssets, RenderInput, TemplateRenderer } from '../../renderer.js';
import { drawBackground } from './background.js';
import type { DrawContext, DrawLayer } from './context.js';
import { collectBuffer, createDocument } from './document.js';
import { drawImages } from './images.js';

export const SVG_PDF_ENGINE = 'svg-pdf';

export interface SvgPdfRendererOptions {
  /** Paints the text fields (BEU-ICT/certificate-manager#320); runs after the images. */
  fieldsLayer?: DrawLayer;
  /** Paints the QR code (BEU-ICT/certificate-manager#323); runs last, on top of everything. */
  qrLayer?: DrawLayer;
}

/**
 * `svg-pdf` engine (spec §7): PDFKit document, static `background.svg` through svg-to-pdfkit,
 * then images, then (when plugged in) fields and the QR code. Fonts come from the template
 * package buffers. The result depends only on the input and the package, never on the clock.
 */
export class SvgPdfRenderer implements TemplateRenderer {
  readonly engine = SVG_PDF_ENGINE;
  private readonly layers: DrawLayer[];

  constructor(options: SvgPdfRendererOptions = {}) {
    this.layers = [drawBackground, drawImages];
    if (options.fieldsLayer) this.layers.push(options.fieldsLayer);
    if (options.qrLayer) this.layers.push(options.qrLayer);
  }

  async render(input: RenderInput, assets: RenderAssets): Promise<Buffer> {
    const { config } = assertTemplateConfig(assets.template.config);
    const page = pageDimensions(config.page);
    const doc = createDocument(page, {
      author: input.organizationName,
      createdAt: input.issuedAt,
    });
    const ctx: DrawContext = {
      doc,
      input,
      assets,
      config,
      page,
      fontName: (key) => `template:${key}`,
    };
    try {
      for (const [key, file] of Object.entries(config.fonts)) {
        const data = assets.fonts.get(key);
        if (data === undefined) throw new Error(`Template font "${key}" (${file}) is not loaded`);
        doc.registerFont(ctx.fontName(key), data);
      }
      for (const layer of this.layers) layer(ctx);
    } catch (error) {
      doc.destroy(); // Release the stream; nothing else holds the half-built document.
      throw error;
    }
    return collectBuffer(doc);
  }

  /** Text fitting arrives with the fields layer (BEU-ICT/certificate-manager#320). */
  checkFit(): FitResult {
    return { fits: true, issues: [] };
  }
}
