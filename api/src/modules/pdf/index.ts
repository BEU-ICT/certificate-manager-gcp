/** Public interface of the pdf module; other modules import only this file. */
export {
  InMemoryRendererRegistry,
  RENDER_ENGINE_UNSUPPORTED,
  type RendererRegistry,
} from './registry.js';
export type {
  FitIssue,
  FitResult,
  RenderAssets,
  RenderInput,
  TemplateRenderer,
} from './renderer.js';
export {
  DefaultPdfService,
  toRenderInput,
  type PdfService,
  type PublicUrlBuilder,
} from './service.js';
export {
  SVG_PDF_ENGINE,
  SvgPdfRenderer,
  TEXT_DOES_NOT_FIT,
  createFields,
  type DrawContext,
  type DrawLayer,
  type FieldsOptions,
  type FieldsPlugin,
  type SvgPdfRendererOptions,
} from './engines/svg-pdf/index.js';
export {
  FormatterError,
  FormatterRegistry,
  TEMPLATE_TIMEZONE,
  type FormatContext,
  type FormatFn,
  type FormatInputByKind,
  type RegisterOptions,
} from './formatters.js';
export { createFormatterRegistry, registerBuiltinFormatters } from './formatters-builtin.js';
export { QR_TOO_SMALL, checkQrFit, drawQr } from './engines/svg-pdf/index.js';
