import type {
  CertificateFilter,
  CertificateRepository,
  EmailStatePatch,
  MarkRevokedResult,
  Page,
  PageRequest,
  ReserveEmailSendResult,
  SetPdfPathResult,
} from '../../ports/index.js';
import { decodeIssuedAtCursor, encodeIssuedAtCursor, pageLimit } from '../../shared/cursor.js';
import type { Certificate } from '../../shared/domain.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import type { CertificateId, EventId, OrganizationId, TemplateRef } from '../../shared/ids.js';

export const MAX_CREATE_MANY = 500;

function matcher(filter: CertificateFilter): (c: Certificate) => boolean {
  return (c) =>
    (filter.organizationId === undefined || c.organizationId === filter.organizationId) &&
    (filter.eventId === undefined || c.eventId === filter.eventId) &&
    (filter.type === undefined || c.type === filter.type) &&
    (filter.status === undefined || c.status === filter.status) &&
    (filter.emailStatus === undefined || c.emailStatus === filter.emailStatus) &&
    (filter.issuedFrom === undefined || c.issuedAt.getTime() >= filter.issuedFrom.getTime()) &&
    (filter.issuedTo === undefined || c.issuedAt.getTime() < filter.issuedTo.getTime());
}

/** `issuedAt` descending, then `id` descending. */
function compareNewestFirst(a: Certificate, b: Certificate): number {
  return b.issuedAt.getTime() - a.issuedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** In-memory repository. Every method is synchronous inside, so each one is atomic like a transaction. */
export class FakeCertificateRepository implements CertificateRepository {
  private readonly byId = new Map<string, Certificate>();

  create(certificate: Certificate): Promise<void> {
    if (this.byId.has(certificate.id)) {
      return Promise.reject(new ConflictError('Certificate already exists'));
    }
    this.byId.set(certificate.id, structuredClone(certificate));
    return Promise.resolve();
  }

  createMany(certificates: readonly Certificate[]): Promise<void> {
    if (certificates.length > MAX_CREATE_MANY) {
      return Promise.reject(
        new ValidationError(`At most ${String(MAX_CREATE_MANY)} certificates per batch`),
      );
    }
    const ids = new Set<string>();
    for (const c of certificates) {
      if (this.byId.has(c.id) || ids.has(c.id)) {
        return Promise.reject(new ConflictError('Certificate already exists'));
      }
      ids.add(c.id);
    }
    for (const c of certificates) this.byId.set(c.id, structuredClone(c));
    return Promise.resolve();
  }

  getById(id: CertificateId): Promise<Certificate | null> {
    const found = this.byId.get(id);
    return Promise.resolve(found ? structuredClone(found) : null);
  }

  getMany(ids: readonly CertificateId[]): Promise<Certificate[]> {
    if (ids.length > MAX_CREATE_MANY) {
      return Promise.reject(
        new ValidationError(`At most ${String(MAX_CREATE_MANY)} certificates per read`),
      );
    }
    const found: Certificate[] = [];
    for (const id of new Set(ids)) {
      const c = this.byId.get(id);
      if (c) found.push(structuredClone(c));
    }
    return Promise.resolve(found);
  }

  list(filter: CertificateFilter, page?: PageRequest): Promise<Page<Certificate>> {
    try {
      const limit = pageLimit(page);
      const after = page?.cursor === undefined ? null : decodeIssuedAtCursor(page.cursor);
      const rest = [...this.byId.values()]
        .filter(matcher(filter))
        .sort(compareNewestFirst)
        .filter(
          (c) =>
            after === null ||
            c.issuedAt.getTime() < after.issuedAtMillis ||
            (c.issuedAt.getTime() === after.issuedAtMillis && c.id < after.id),
        );
      const items = rest.slice(0, limit);
      const last = items.at(-1);
      return Promise.resolve({
        items: items.map((c) => structuredClone(c)),
        nextCursor:
          rest.length > limit && last ? encodeIssuedAtCursor(last.issuedAt, last.id) : null,
      });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  count(filter: CertificateFilter): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter(matcher(filter)).length);
  }

  markRevoked(
    id: CertificateId,
    revocation: { reason: string; at: Date },
  ): Promise<MarkRevokedResult> {
    const c = this.byId.get(id);
    if (!c) return Promise.resolve({ outcome: 'not_found' });
    if (c.status === 'revoked') return Promise.resolve({ outcome: 'already_revoked' });
    const previousPdfPath = c.pdfPath ?? null;
    c.status = 'revoked';
    c.revokedAt = new Date(revocation.at);
    c.revokeReason = revocation.reason;
    c.updatedAt = new Date(revocation.at);
    return Promise.resolve({ outcome: 'revoked', previousPdfPath });
  }

  clearPdfPath(id: CertificateId): Promise<boolean> {
    const c = this.byId.get(id);
    if (!c) return Promise.resolve(false);
    delete c.pdfPath;
    delete c.pdfGeneratedAt;
    return Promise.resolve(true);
  }

  setPdfPathIfAbsent(
    id: CertificateId,
    pdf: { pdfPath: string; generatedAt: Date },
  ): Promise<SetPdfPathResult | null> {
    const c = this.byId.get(id);
    if (!c) return Promise.resolve(null);
    if (c.pdfPath === undefined && c.status === 'active') {
      c.pdfPath = pdf.pdfPath;
      c.pdfGeneratedAt = new Date(pdf.generatedAt);
      return Promise.resolve({ winner: true, pdfPath: pdf.pdfPath, status: c.status });
    }
    return Promise.resolve({ winner: false, pdfPath: c.pdfPath ?? null, status: c.status });
  }

  updateEmailState(id: CertificateId, patch: EmailStatePatch): Promise<boolean> {
    const c = this.byId.get(id);
    if (!c) return Promise.resolve(false);
    if (patch.emailStatus !== undefined) c.emailStatus = patch.emailStatus;
    if (patch.emailAttempts !== undefined) c.emailAttempts = patch.emailAttempts;
    if (patch.emailSentAt === null) delete c.emailSentAt;
    else if (patch.emailSentAt !== undefined) c.emailSentAt = new Date(patch.emailSentAt);
    if (patch.emailLastError === null) delete c.emailLastError;
    else if (patch.emailLastError !== undefined) c.emailLastError = patch.emailLastError;
    c.updatedAt = new Date(patch.updatedAt);
    return Promise.resolve(true);
  }

  reserveEmailSend(
    id: CertificateId,
    options: { at: Date; firstSendOnly: boolean },
  ): Promise<ReserveEmailSendResult> {
    const c = this.byId.get(id);
    if (!c) return Promise.resolve({ outcome: 'not_found' });
    if (
      options.firstSendOnly &&
      (c.status !== 'active' || c.emailStatus !== 'pending' || c.emailAttempts > 0)
    ) {
      return Promise.resolve({ outcome: 'not_eligible' });
    }
    c.emailAttempts += 1;
    c.updatedAt = new Date(options.at);
    return Promise.resolve({ outcome: 'reserved', sequence: c.emailAttempts });
  }

  countByTemplate(ref: TemplateRef): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter((c) => c.templateId === ref).length);
  }

  countByOrganization(organizationId: OrganizationId): Promise<number> {
    return this.count({ organizationId });
  }

  countByEvent(eventId: EventId): Promise<number> {
    return this.count({ eventId });
  }
}
