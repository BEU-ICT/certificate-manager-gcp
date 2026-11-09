import type {
  CertificateFilter,
  CertificateRepository,
  Page,
  PageRequest,
} from '../../ports/index.js';
import type { Certificate } from '../../shared/domain.js';
import { NotFoundError } from '../../shared/errors.js';
import { parseCertificateId } from '../../shared/ids.js';

/** Read side of the certificates module used by the admin API (list, count, detail). */
export interface CertificateQueryService {
  /** Newest first (`issuedAt desc, id desc`); reads at most `limit + 1` documents. */
  list(filter: CertificateFilter, page?: PageRequest): Promise<Page<Certificate>>;
  /** Native aggregate count; never reads the documents. */
  count(filter: CertificateFilter): Promise<number>;
  /** `NotFoundError` for malformed and unknown ids alike (one document read). */
  get(id: string): Promise<Certificate>;
}

export class DefaultCertificateQueryService implements CertificateQueryService {
  constructor(private readonly certificates: CertificateRepository) {}

  list(filter: CertificateFilter, page?: PageRequest): Promise<Page<Certificate>> {
    return this.certificates.list(filter, page);
  }

  count(filter: CertificateFilter): Promise<number> {
    return this.certificates.count(filter);
  }

  async get(id: string): Promise<Certificate> {
    const found = await this.certificates.getById(parseCertificateId(id));
    if (!found) throw new NotFoundError('Certificate not found');
    return found;
  }
}
