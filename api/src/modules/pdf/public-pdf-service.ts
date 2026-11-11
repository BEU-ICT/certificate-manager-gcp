import type {
  CertificateRepository,
  Clock,
  IdGenerator,
  StorageGateway,
} from '../../ports/index.js';
import { AppError, GoneError, NotFoundError, UnavailableError } from '../../shared/errors.js';
import { parseCertificateId, type CertificateId } from '../../shared/ids.js';
import type { TemplateService } from '../templates/index.js';
import type { PdfService } from './service.js';

/** Minimal logger shape (pino-compatible) so the module needs no logging dependency. */
export interface PublicPdfLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  /** Optional so that the module accepts the same logger shape as the other pdf/template services. */
  warn?(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Where the returned `pdfPath` came from; logged as `cache` of `pdf_generated`. */
export type PublicPdfSource = 'hit' | 'generated' | 'raced';

export interface PublicPdf {
  /** Object name in the `pdfs` bucket (`<token>.pdf`). */
  pdfPath: string;
  source: PublicPdfSource;
}

export interface EnsurePdfOptions {
  /**
   * Called only when the PDF has to be generated (not for an existing `pdfPath`); throws to refuse,
   * e.g. the `FEATURE_PUBLIC_PDF_GENERATION` kill switch.
   */
  assertCanGenerate?: () => void;
}

/** Public on-demand PDF generation (Flow B of BEU-ICT/certificate-manager#236). */
export interface PublicPdfService {
  /**
   * Returns the stored PDF of a certificate, generating it on first use. `NotFoundError` for
   * malformed and unknown IDs, `GoneError` for revoked certificates, `UnavailableError` (retry in
   * 5 s) for storage or database outages, a plain `Error` (500, logged) for corrupt template data.
   * Concurrent calls for one ID in this instance share one render; across instances the transactional
   * `setPdfPathIfAbsent` arbitrates and the loser removes its surplus object.
   */
  ensurePdf(id: unknown, options?: EnsurePdfOptions): Promise<PublicPdf>;
}

export interface PublicPdfServiceDeps {
  certificates: CertificateRepository;
  templates: Pick<TemplateService, 'get'>;
  pdf: Pick<PdfService, 'render'>;
  storage: StorageGateway;
  ids: IdGenerator;
  clock: Clock;
  logger?: PublicPdfLogger;
}

const RETRY_AFTER_SECONDS = 5;

export class DefaultPublicPdfService implements PublicPdfService {
  private readonly inFlight = new Map<CertificateId, Promise<PublicPdf>>();

  constructor(private readonly deps: PublicPdfServiceDeps) {}

  async ensurePdf(rawId: unknown, options: EnsurePdfOptions = {}): Promise<PublicPdf> {
    const id = parseCertificateId(rawId);
    const certificate = await this.deps.certificates.getById(id);
    if (!certificate) throw new NotFoundError('Certificate not found');
    if (certificate.status === 'revoked') throw new GoneError('Certificate has been revoked');
    if (certificate.pdfPath) return { pdfPath: certificate.pdfPath, source: 'hit' };
    options.assertCanGenerate?.();

    const running = this.inFlight.get(id);
    if (running) return running;
    const flight = this.generate(id, certificate.templateId).finally(() => {
      this.inFlight.delete(id);
    });
    this.inFlight.set(id, flight);
    return flight;
  }

  private async generate(id: CertificateId, templateRef: string): Promise<PublicPdf> {
    const { certificates, storage, ids, clock, logger } = this.deps;
    const started = performance.now();

    // Re-read inside the flight: the certificate may have changed since the first read.
    const certificate = await certificates.getById(id);
    if (!certificate) throw new NotFoundError('Certificate not found');
    if (certificate.status === 'revoked') throw new GoneError('Certificate has been revoked');
    if (certificate.pdfPath) return { pdfPath: certificate.pdfPath, source: 'hit' };

    let body: Buffer;
    try {
      const template = await this.deps.templates.get(templateRef);
      body = await this.deps.pdf.render(certificate, template);
    } catch (error) {
      // Capacity and timeout errors are retryable; everything else is corrupt data or a bug.
      if (error instanceof UnavailableError) throw error;
      logger?.error(
        {
          certId: id,
          templateRef,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorCode: error instanceof AppError ? error.code : undefined,
        },
        'public PDF generation failed: template or render error',
      );
      throw new Error('PDF generation failed', { cause: error });
    }

    const pdfPath = `${ids.newToken()}.pdf`;
    try {
      const { created } = await storage.putIfAbsent('pdfs', pdfPath, body, {
        contentType: 'application/pdf',
        cacheControl: 'no-cache',
        contentDisposition: `inline; filename="certificate-${id}.pdf"`,
      });
      if (!created) throw new Error('PDF object name collision');
    } catch (error) {
      logger?.error({ certId: id, templateRef }, 'public PDF upload failed');
      if (error instanceof UnavailableError) throw error;
      throw new UnavailableError(RETRY_AFTER_SECONDS);
    }

    let result;
    try {
      result = await certificates.setPdfPathIfAbsent(id, {
        pdfPath,
        generatedAt: clock.now(),
      });
    } catch {
      logger?.error({ certId: id, templateRef }, 'public PDF reference could not be stored');
      await this.discard(id, pdfPath);
      throw new UnavailableError(RETRY_AFTER_SECONDS);
    }

    if (result?.winner === true) {
      logger?.info(
        {
          certId: id,
          templateRef,
          durationMs: Math.round(performance.now() - started),
          bytes: body.length,
          cache: 'miss',
        },
        'pdf_generated',
      );
      return { pdfPath, source: 'generated' };
    }

    // Lost the race, revoked meanwhile or deleted: my object is surplus in every case.
    await this.discard(id, pdfPath);
    if (result === null) throw new NotFoundError('Certificate not found');
    if (result.status === 'revoked') throw new GoneError('Certificate has been revoked');
    if (result.pdfPath === null) throw new UnavailableError(RETRY_AFTER_SECONDS);
    return { pdfPath: result.pdfPath, source: 'raced' };
  }

  /** Best-effort delete of an object this request created; a failure is logged, never thrown. */
  private async discard(id: CertificateId, pdfPath: string): Promise<void> {
    try {
      await this.deps.storage.delete('pdfs', pdfPath);
    } catch {
      this.deps.logger?.warn?.({ certId: id }, 'surplus public PDF could not be deleted');
    }
  }
}
