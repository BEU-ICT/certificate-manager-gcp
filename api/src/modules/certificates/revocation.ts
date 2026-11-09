import type { Certificate } from '../../shared/domain.js';
import { NotFoundError } from '../../shared/errors.js';
import { parseCertificateId, type CertificateId } from '../../shared/ids.js';
import type { CertificateRepository, Clock, EventBus, StorageGateway } from '../../ports/index.js';

/** Reported when the stored PDF could not be deleted; the revocation itself succeeded. */
export const PDF_DELETE_FAILED = 'PDF_DELETE_FAILED';

export interface RevokeResult {
  certificate: Certificate;
  /** True only for the call that performed `active -> revoked` (retries are idempotent no-ops). */
  newlyRevoked: boolean;
  /** `["PDF_DELETE_FAILED"]` when the object deletion failed; `pdfPath` is then kept for a retry. */
  warnings: string[];
}

export interface RevocationService {
  /**
   * Revokes a certificate (ADR 0010). `NotFoundError` for unknown or malformed IDs. Repeating the
   * call is not an error: the original reason is kept (a different one is ignored) and a PDF that
   * is still referenced is deleted again.
   */
  revoke(id: string, reason: string): Promise<RevokeResult>;
}

export class DefaultRevocationService implements RevocationService {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly storage: StorageGateway,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async revoke(rawId: string, reason: string): Promise<RevokeResult> {
    const id = parseCertificateId(rawId);
    const at = this.clock.now();
    const marked = await this.certificates.markRevoked(id, { reason, at });
    if (marked.outcome === 'not_found') throw new NotFoundError('Certificate not found');

    const newlyRevoked = marked.outcome === 'revoked';
    // Repair path: an earlier call may have failed after the commit and left the reference behind.
    const pdfPath = newlyRevoked
      ? marked.previousPdfPath
      : ((await this.certificates.getById(id))?.pdfPath ?? null);

    const warnings: string[] = [];
    if (pdfPath && !(await this.deletePdf(id, pdfPath))) warnings.push(PDF_DELETE_FAILED);

    if (newlyRevoked)
      await this.eventBus.publish('certificate.revoked', {
        certificateId: id,
        occurredAt: at,
      });

    const certificate = await this.certificates.getById(id);
    if (!certificate) throw new NotFoundError('Certificate not found');
    return { certificate, newlyRevoked, warnings };
  }

  /** Deletes the object, then clears the reference; false when either step failed. */
  private async deletePdf(id: CertificateId, pdfPath: string): Promise<boolean> {
    try {
      await this.storage.delete('pdfs', pdfPath);
      await this.certificates.clearPdfPath(id);
      return true;
    } catch {
      return false;
    }
  }
}
