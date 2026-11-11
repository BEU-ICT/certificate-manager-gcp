import type PDFDocument from 'pdfkit';
import type { PageDimensions, TemplateConfig } from '../../../templates/index.js';
import type { RenderAssets, RenderInput } from '../../renderer.js';

/** Everything a drawing layer may use. The document has exactly one page when layers run. */
export interface DrawContext {
  doc: InstanceType<typeof PDFDocument>;
  input: RenderInput;
  assets: RenderAssets;
  config: TemplateConfig;
  page: PageDimensions;
  /** Name under which the template font `key` is registered on the document. */
  fontName(key: string): string;
}

/**
 * One painting step. The renderer runs layers in the order background, images, fields, QR so
 * later layers cover earlier ones. Fields (BEU-ICT/certificate-manager#320) and the QR code
 * (BEU-ICT/certificate-manager#323) plug in through `SvgPdfRendererOptions`; layers must be
 * synchronous and deterministic.
 */
export type DrawLayer = (ctx: DrawContext) => void;
