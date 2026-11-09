import type { CertificateRepository } from '../../ports/index.js';
import type { Certificate } from '../../shared/domain.js';
import { NotFoundError } from '../../shared/errors.js';
import { parseCertificateId } from '../../shared/ids.js';

export interface CertificateService {
  /**
   * Public lookup by ID. The ID shape is validated before any read; a malformed and an unknown ID
   * throw the same `NotFoundError`. Costs exactly one repository read (zero when malformed).
   */
  getPublic(id: unknown): Promise<Certificate>;
}

export class DefaultCertificateService implements CertificateService {
  constructor(private readonly certificates: CertificateRepository) {}

  async getPublic(id: unknown): Promise<Certificate> {
    const certificateId = parseCertificateId(id);
    const certificate = await this.certificates.getById(certificateId);
    if (!certificate) throw new NotFoundError('Certificate not found');
    return certificate;
  }
}
