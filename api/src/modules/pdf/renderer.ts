import type { CertificateType } from '../../shared/certificate-types.js';
import type { LoadedTemplate } from '../templates/index.js';

/**
 * Everything a renderer may print on a certificate. Deliberately has no e-mail address: the PDF is
 * public, so personal contact data never reaches an engine.
 */
export interface RenderInput {
  ownerName: string;
  subject: string;
  skills: string[];
  issuedAt: Date;
  /** Organization name snapshot of the certificate; the PDF `Author`. Absent for admin previews. */
  organizationName?: string;
  type: CertificateType;
  /** Public verification URL (printed as text / encoded in a QR code). */
  publicUrl: string;
}

/** One field whose content does not fit its box. */
export interface FitIssue {
  field: string;
  message: string;
  /** Machine-readable reason, e.g. `TEXT_DOES_NOT_FIT` (BEU-ICT/certificate-manager#320). */
  reason?: string;
  /** Lines the text needs at the smallest allowed size (`TEXT_DOES_NOT_FIT`). */
  requiredLines?: number;
  maxLines?: number;
  minSize?: number;
}

export interface FitResult {
  fits: boolean;
  issues: FitIssue[];
}

/** Template package files handed to an engine (read-only, shared with the cache). */
export type RenderAssets = LoadedTemplate;

/** A PDF engine. Selected by `template.config.engine`; add one by registering it in the composition root. */
export interface TemplateRenderer {
  /** Engine name matched against `config.engine`. */
  readonly engine: string;
  /** `options.signal` aborts at the render timeout (BEU-ICT/certificate-manager#328); engines may honour it. */
  render(
    input: RenderInput,
    assets: RenderAssets,
    options?: { signal?: AbortSignal },
  ): Promise<Buffer>;
  checkFit(input: RenderInput, assets: RenderAssets): FitResult;
}
