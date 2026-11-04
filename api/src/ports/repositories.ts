import type { Certificate, CertificateEvent, Organization, Template } from '../shared/domain.js';
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
  /** Fails with `ConflictError` when the slug is taken. */
  create(organization: Organization): Promise<void>;
  getById(id: OrganizationId): Promise<Organization | null>;
  getBySlug(slug: string): Promise<Organization | null>;
  list(page?: PageRequest): Promise<Page<Organization>>;
  count(): Promise<number>;
}

export interface EventRepository {
  /** Fails with `ConflictError` when the slug is taken within the organization. */
  create(event: CertificateEvent): Promise<void>;
  getById(id: EventId): Promise<CertificateEvent | null>;
  getBySlug(organizationId: OrganizationId, slug: string): Promise<CertificateEvent | null>;
  listByOrganization(
    organizationId: OrganizationId,
    page?: PageRequest,
  ): Promise<Page<CertificateEvent>>;
  count(organizationId?: OrganizationId): Promise<number>;
}

export interface TemplateRepository {
  /** Fails with `ConflictError` when the template reference exists. Templates are immutable. */
  create(template: Template): Promise<void>;
  getByRef(ref: TemplateRef): Promise<Template | null>;
  /** Highest version for the (organization, event, type) triple, or `null`. */
  getLatest(
    organizationId: OrganizationId,
    eventId: EventId,
    type: string,
  ): Promise<Template | null>;
  listByEvent(eventId: EventId, page?: PageRequest): Promise<Page<Template>>;
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
