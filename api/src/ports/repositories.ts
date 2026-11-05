import type {
  Certificate,
  CertificateEvent,
  EmailLanguage,
  Organization,
  Template,
} from '../shared/domain.js';
import type { CertificateId, EventId, OrganizationId, TemplateRef } from '../shared/ids.js';
import type { Filter, Page, PageRequest } from './common.js';

/*
 * Contract shared by every repository:
 * - Reads of a missing entity return `null` (never throw).
 * - `create` fails with `ConflictError` (src/shared/errors.ts) when a unique key
 *   already exists (see "Unique keys" in BEU-ICT/certificate-manager#23); nothing is written.
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

export interface CertificateRepository {
  /** Fails with `ConflictError` when the ID exists. */
  create(certificate: Certificate): Promise<void>;
  /** Exactly one document read. */
  getById(id: CertificateId): Promise<Certificate | null>;
  /** Ordered by `issuedAt` descending. */
  list(filter: Filter, page?: PageRequest): Promise<Page<Certificate>>;
  count(filter: Filter): Promise<number>;
  /** Idempotent: revoking a revoked certificate succeeds without change. Returns false if not found. */
  revoke(id: CertificateId, at: Date): Promise<boolean>;
}
