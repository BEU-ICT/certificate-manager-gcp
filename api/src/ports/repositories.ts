import type {
  Certificate,
  CertificateEvent,
  CertificateStatus,
  EmailLanguage,
  EmailStatus,
  Organization,
  Template,
} from '../shared/domain.js';
import type { CertificateType } from '../shared/certificate-types.js';
import type { CertificateId, EventId, OrganizationId, TemplateRef } from '../shared/ids.js';
import type { Page, PageRequest } from './common.js';

/*
 * Contract shared by every repository:
 * - Reads of a missing entity return `null` (never throw).
 * - `create` fails with `ConflictError` (src/shared/errors.ts) when a unique key
 *   already exists (see "Unique keys" in BEU-ICT/certificate-manager#236); nothing is written.
 * - `list` is ordered newest first and cursor-paginated; the cursor is opaque.
 * - `count` never reads whole collections; adapters use native aggregate counts.
 * Method lists are finalised by the epics that own each entity; changing a
 * method requires updating the fakes and contract tests.
 */

export interface OrganizationRepository {
  /**
   * Creates the organization and reserves its slug in the same transaction.
   * Fails with `SlugTakenError` (a `ConflictError`) when the slug is reserved; nothing is written.
   */
  create(organization: Organization): Promise<void>;
  getById(id: OrganizationId): Promise<Organization | null>;
  getBySlug(slug: string): Promise<Organization | null>;
  /** The existing organizations among `ids` (at most 100, one batched read); order unspecified. */
  getMany(ids: readonly OrganizationId[]): Promise<Organization[]>;
  /** Ordered by `name` ascending (byte order), then `id`; not newest first. */
  list(page?: PageRequest): Promise<Page<Organization>>;
  /** Changes `name` and `updatedAt` only. Returns the updated organization, or `null` if missing. */
  updateName(id: OrganizationId, name: string, updatedAt: Date): Promise<Organization | null>;
  /** Deletes the organization and releases its slug in the same transaction. False if missing. */
  delete(id: OrganizationId): Promise<boolean>;
  count(): Promise<number>;
}

export interface EventRepository {
  /**
   * Creates the event and reserves `(organizationId, slug)` in the same transaction.
   * Fails with `SlugTakenError` (a `ConflictError`) when the slug is taken within the organization.
   */
  create(event: CertificateEvent): Promise<void>;
  getById(id: EventId): Promise<CertificateEvent | null>;
  getBySlug(organizationId: OrganizationId, slug: string): Promise<CertificateEvent | null>;
  /** Newest first (`createdAt` descending, then `id`), optionally limited to one organization. */
  list(
    filter?: { organizationId?: OrganizationId },
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>>;
  /** Changes only the given fields and `updatedAt`; returns the updated event, or `null` if missing. */
  update(
    id: EventId,
    changes: { name?: string; emailLanguage?: EmailLanguage },
    updatedAt: Date,
  ): Promise<CertificateEvent | null>;
  /** Deletes the event and releases its slug in the same transaction. False if missing. */
  delete(id: EventId): Promise<boolean>;
  count(organizationId?: OrganizationId): Promise<number>;
}

export interface TemplateFilter {
  organizationId?: OrganizationId;
  eventId?: EventId;
  type?: string;
}

export interface TemplateRepository {
  /**
   * Creates the template document with `create()` semantics. Fails with `ConflictError` when the
   * reference exists; nothing is written. Templates are immutable: there is no update.
   */
  create(template: Template): Promise<void>;
  getByReference(reference: TemplateRef): Promise<Template | null>;
  /** Highest version for the (organization, event, type) triple, or `null`. */
  getLatest(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<Template | null>;
  /** Newest first (`createdAt` descending, then reference), optionally filtered. */
  list(filter?: TemplateFilter, page?: PageRequest): Promise<Page<Template>>;
  /** Highest version for the triple, or `null` when there is none (the next one is then 0). */
  maxVersion(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<number | null>;
  /** Number of templates matching the filter (native count, never reads documents). */
  count(filter?: TemplateFilter): Promise<number>;
}

/** Equality filters plus an `issuedAt` range (`issuedFrom` inclusive, `issuedTo` exclusive); all ANDed. */
export interface CertificateFilter {
  organizationId?: OrganizationId;
  eventId?: EventId;
  type?: CertificateType;
  status?: CertificateStatus;
  emailStatus?: EmailStatus;
  issuedFrom?: Date;
  issuedTo?: Date;
}

/** Outcome of {@link CertificateRepository.markRevoked}; `previousPdfPath` is set only when revoked. */
export type MarkRevokedResult =
  | { outcome: 'revoked'; previousPdfPath: string | null }
  | { outcome: 'already_revoked' }
  | { outcome: 'not_found' };

/** Outcome of {@link CertificateRepository.setPdfPathIfAbsent}; `pdfPath` is the stored one (the winner's). */
export interface SetPdfPathResult {
  winner: boolean;
  pdfPath: string | null;
  status: CertificateStatus;
}

/** Fields `updateEmailState` may change; `null` clears an optional field. `updatedAt` is required. */
export interface EmailStatePatch {
  emailStatus?: EmailStatus;
  emailAttempts?: number;
  emailSentAt?: Date | null;
  emailLastError?: string | null;
  updatedAt: Date;
}

export interface CertificateRepository {
  /** Document ID = certificate ID. Fails with `ConflictError` when the ID exists. */
  create(certificate: Certificate): Promise<void>;
  /**
   * Creates up to 500 certificates in one atomic batch: all or none. Fails with `ConflictError`
   * (nothing written) when any ID exists or repeats, `ValidationError` for more than 500.
   */
  createMany(certificates: readonly Certificate[]): Promise<void>;
  /** Exactly one document read. */
  getById(id: CertificateId): Promise<Certificate | null>;
  /**
   * Ordered by `issuedAt` descending, then `id` descending (total order, stable with identical
   * `issuedAt`). Reads `limit + 1` documents: the extra one only decides `nextCursor`.
   * An unusable cursor is a `ValidationError`.
   */
  list(filter: CertificateFilter, page?: PageRequest): Promise<Page<Certificate>>;
  /** Native aggregate count; never reads the documents. */
  count(filter: CertificateFilter): Promise<number>;
  /**
   * Transaction: revokes only an `active` certificate (sets `status`, `revokedAt`, `revokeReason`,
   * `updatedAt`) and returns its previous `pdfPath`. The PDF reference itself stays until
   * `clearPdfPath`. Revoking a revoked certificate changes nothing.
   */
  markRevoked(
    id: CertificateId,
    revocation: { reason: string; at: Date },
  ): Promise<MarkRevokedResult>;
  /**
   * Unconditionally removes `pdfPath` and `pdfGeneratedAt`; does not touch `updatedAt`.
   * False if the certificate does not exist.
   */
  clearPdfPath(id: CertificateId): Promise<boolean>;
  /**
   * Transaction: sets `pdfPath`/`pdfGeneratedAt` only when `pdfPath` is unset **and** the status is
   * `active`; `winner` says whether this call wrote. `null` if the certificate does not exist.
   */
  setPdfPathIfAbsent(
    id: CertificateId,
    pdf: { pdfPath: string; generatedAt: Date },
  ): Promise<SetPdfPathResult | null>;
  /**
   * Unconditional merge: changes only the given e-mail fields and `updatedAt`, with no status or
   * attempt guard. False if the certificate does not exist.
   */
  updateEmailState(id: CertificateId, patch: EmailStatePatch): Promise<boolean>;
  /** Certificates rendered from the template reference (reference checks). */
  countByTemplate(ref: TemplateRef): Promise<number>;
  countByOrganization(organizationId: OrganizationId): Promise<number>;
  countByEvent(eventId: EventId): Promise<number>;
}
