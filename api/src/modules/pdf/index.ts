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
