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
export {
  DEFAULT_MAX_CONCURRENT_RENDERS,
  DEFAULT_QUEUE_WAIT_MS,
  DEFAULT_RENDER_TIMEOUT_MS,
  MAX_PDF_BYTES,
  RenderLimiter,
  type LimitedResult,
  type RenderLimiterOptions,
} from './limiter.js';
export { RENDER_TOO_LARGE, type PdfLogger, type PdfServiceOptions } from './service.js';
