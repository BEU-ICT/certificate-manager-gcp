import type { CertificateRepository, Clock, PrepareEmailResendResult } from '../../ports/index.js';
import type { Certificate } from '../../shared/domain.js';
import { NotFoundError } from '../../shared/errors.js';
import { parseCertificateId } from '../../shared/ids.js';

/** A `pending` e-mail older than this (by `updatedAt`) is considered stuck and may be resent. */
export const EMAIL_STUCK_AFTER_MS = 2 * 60 * 60 * 1000;

export interface CertificateService {
  /**
   * Public lookup by ID. The ID shape is validated before any read; a malformed and an unknown ID
   * throw the same `NotFoundError`. Costs exactly one repository read (zero when malformed).
   */
  getPublic(id: unknown): Promise<Certificate>;
  /**
   * Atomically increments `emailAttempts` and returns the new value `n` (first send: 1), used to
   * name the e-mail task `email-<id>-<n>`. By default only the first send is reserved: `null`
   * means the certificate is not eligible (not `active`, not `pending`, or `emailAttempts` > 0),
   * which makes a duplicate `certificate.issued` delivery a no-op. `{ resend: true }` skips that
   * guard and always increments. `NotFoundError` for an unknown or malformed ID.
   * Costs one repository transaction (one read, one write).
   */
  reserveEmailSend(id: string, options?: { resend?: boolean }): Promise<number | null>;
  /**
   * Admin resend, one repository transaction (one read, one write): checks the preconditions
   * (see `CertificateRepository.prepareEmailResend`), stores the corrected `email` if given,
   * sets `emailStatus=pending`, clears `emailLastError` and reserves the next sequence. Returns
   * the outcome; the caller maps refusals to errors. `email` must already be validated/lowercased.
   */
  prepareEmailResend(id: string, options?: { email?: string }): Promise<PrepareEmailResendResult>;
  /**
   * Records that the e-mail could not be handed to the queue: `emailStatus=failed`,
   * `emailLastError=code`. `NotFoundError` for an unknown or malformed ID.
   */
  markEmailFailed(id: string, code: string): Promise<void>;
  /**
   * Records a delivered e-mail: `emailStatus=sent`, `emailSentAt=now`, `emailLastError` cleared.
   * `NotFoundError` for an unknown or malformed ID.
   */
  markEmailSent(id: string): Promise<void>;
}

export class DefaultCertificateService implements CertificateService {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly clock: Clock,
  ) {}

  async getPublic(id: unknown): Promise<Certificate> {
    const certificateId = parseCertificateId(id);
    const certificate = await this.certificates.getById(certificateId);
    if (!certificate) throw new NotFoundError('Certificate not found');
    return certificate;
  }

  async reserveEmailSend(id: string, options: { resend?: boolean } = {}): Promise<number | null> {
    const result = await this.certificates.reserveEmailSend(parseCertificateId(id), {
      at: this.clock.now(),
      firstSendOnly: options.resend !== true,
    });
    if (result.outcome === 'not_found') throw new NotFoundError('Certificate not found');
    return result.outcome === 'reserved' ? result.sequence : null;
  }

  async prepareEmailResend(
    id: string,
    options: { email?: string } = {},
  ): Promise<PrepareEmailResendResult> {
    const at = this.clock.now();
    return this.certificates.prepareEmailResend(parseCertificateId(id), {
      at,
      stuckBefore: new Date(at.getTime() - EMAIL_STUCK_AFTER_MS),
      ...(options.email !== undefined && { email: options.email }),
    });
  }

  async markEmailFailed(id: string, code: string): Promise<void> {
    const found = await this.certificates.updateEmailState(parseCertificateId(id), {
      emailStatus: 'failed',
      emailLastError: code,
      updatedAt: this.clock.now(),
    });
    if (!found) throw new NotFoundError('Certificate not found');
  }

  async markEmailSent(id: string): Promise<void> {
    const now = this.clock.now();
    const found = await this.certificates.updateEmailState(parseCertificateId(id), {
      emailStatus: 'sent',
      emailSentAt: now,
      emailLastError: null,
      updatedAt: now,
    });
    if (!found) throw new NotFoundError('Certificate not found');
  }
}
