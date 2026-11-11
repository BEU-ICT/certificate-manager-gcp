import type { Certificate, Template } from '../../shared/domain.js';
import type { TemplateAssets } from '../templates/index.js';
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

export class DefaultPdfService implements PdfService {
  constructor(
    private readonly registry: RendererRegistry,
    private readonly assets: TemplateAssets,
    private readonly publicUrl: PublicUrlBuilder,
  ) {}

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

  private async renderWith(reference: string, input: RenderInput): Promise<Buffer> {
    const loaded = await this.assets.load(reference);
    return this.registry.get(engineOf(loaded.template)).render(input, loaded);
  }
}

/** Engine name from the stored config; anything but a string is an unknown engine. */
function engineOf(template: Template): string {
  const engine = template.config['engine'];
  return typeof engine === 'string' ? engine : '';
}
