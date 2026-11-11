import { UnprocessableError } from '../../shared/errors.js';
import type { Certificate, Template } from '../../shared/domain.js';
import type { TemplateAssets } from '../templates/index.js';
import { RenderLimiter, MAX_PDF_BYTES } from './limiter.js';
import type { RendererRegistry } from './registry.js';
import type { FitResult, RenderInput } from './renderer.js';

/** Public module interface: engine-agnostic rendering. */
export interface PdfService {
  render(certificate: Certificate, template: Template): Promise<Buffer>;
  checkFit(certificate: Certificate, template: Template): Promise<FitResult>;
  /** Renders sample data with a stored template (admin preview). */
  preview(templateRef: string, sample: RenderInput): Promise<Buffer>;
}

/** Builds the public verification URL of a certificate (configuration of the composition root). */
export type PublicUrlBuilder = (certificate: Certificate) => string;

/** Maps a certificate to engine input; the e-mail address is intentionally dropped. */
export function toRenderInput(certificate: Certificate, publicUrl: string): RenderInput {
  return {
    ownerName: certificate.ownerName,
    subject: certificate.subject,
    skills: [...certificate.skills],
    issuedAt: certificate.issuedAt,
    organizationName: certificate.organizationName,
    type: certificate.type,
    publicUrl,
  };
}

/** Minimal logger shape (pino-compatible) so the module needs no logging dependency. */
export interface PdfLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const RENDER_TOO_LARGE = 'RENDER_TOO_LARGE';

export interface PdfServiceOptions {
  /** Concurrency, queue and timeout guard; default `new RenderLimiter()` (3 permits, 10 s queue, 30 s timeout). */
  limiter?: RenderLimiter;
  logger?: PdfLogger;
  /** PDF size cap in bytes; default 2 MB. */
  maxPdfBytes?: number;
}

export class DefaultPdfService implements PdfService {
  private readonly limiter: RenderLimiter;
  private readonly logger: PdfLogger | undefined;
  private readonly maxPdfBytes: number;

  constructor(
    private readonly registry: RendererRegistry,
    private readonly assets: TemplateAssets,
    private readonly publicUrl: PublicUrlBuilder,
    options: PdfServiceOptions = {},
  ) {
    this.limiter = options.limiter ?? new RenderLimiter();
    this.logger = options.logger;
    this.maxPdfBytes = options.maxPdfBytes ?? MAX_PDF_BYTES;
  }

  async render(certificate: Certificate, template: Template): Promise<Buffer> {
    return this.renderWith(
      template.reference,
      toRenderInput(certificate, this.publicUrl(certificate)),
    );
  }

  async checkFit(certificate: Certificate, template: Template): Promise<FitResult> {
    const input = toRenderInput(certificate, this.publicUrl(certificate));
    const loaded = await this.assets.load(template.reference);
    return this.registry.get(engineOf(loaded.template)).checkFit(input, loaded);
  }

  async preview(templateRef: string, sample: RenderInput): Promise<Buffer> {
    return this.renderWith(templateRef, sample);
  }

  /** Renders under the limiter (permit, timeout), enforces the size cap and logs `pdf_rendered`. */
  private async renderWith(reference: string, input: RenderInput): Promise<Buffer> {
    const started = performance.now();
    let aborted: AbortSignal | undefined;
    const { value: pdf, queuedMs } = await this.limiter.run(async (signal) => {
      aborted = signal;
      const loaded = await this.assets.load(reference);
      return this.registry.get(engineOf(loaded.template)).render(input, loaded, { signal });
    });
    aborted?.throwIfAborted();
    if (pdf.length > this.maxPdfBytes) {
      this.logger?.error(
        { reference, bytes: pdf.length, maxBytes: this.maxPdfBytes },
        'rendered PDF exceeds the size cap (unoptimised image?)',
      );
      throw new UnprocessableError(RENDER_TOO_LARGE, 'Rendered PDF exceeds the size limit', [
        { path: 'template', message: 'Rendered PDF exceeds 2 MB; check for unoptimised images' },
      ]);
    }
    this.logger?.info(
      {
        reference,
        durationMs: Math.round(performance.now() - started - queuedMs),
        bytes: pdf.length,
        queuedMs,
      },
      'pdf_rendered',
    );
    return pdf;
  }
}

/** Engine name from the stored config; anything but a string is an unknown engine. */
function engineOf(template: Template): string {
  const engine = template.config['engine'];
  return typeof engine === 'string' ? engine : '';
}
