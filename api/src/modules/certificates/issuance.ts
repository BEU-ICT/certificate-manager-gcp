import type { CertificateRepository, Clock, EventBus, IdGenerator } from '../../ports/index.js';
import type { Certificate, Template } from '../../shared/domain.js';
import type { CertificateType } from '../../shared/certificate-types.js';
import {
  BULK_INVALID_MAX_DETAILS,
  BulkInvalidError,
  ConflictError,
  UnprocessableError,
  ValidationError,
  type ErrorDetail,
} from '../../shared/errors.js';
import {
  asEventId,
  asOrganizationId,
  type EventId,
  type OrganizationId,
} from '../../shared/ids.js';
import type { EventService } from '../events/index.js';
import type { OrganizationService } from '../organizations/index.js';
import type { FitResult } from '../pdf/index.js';
import type { TemplateService } from '../templates/index.js';
import { emailInitialStatus } from './domain.js';
import { bulkItemSchema } from './schemas.js';

export const TEMPLATE_MISMATCH = 'TEMPLATE_MISMATCH';
export const TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND';
export const EVENT_ORG_MISMATCH = 'EVENT_ORG_MISMATCH';
export const TEXT_DOES_NOT_FIT = 'TEXT_DOES_NOT_FIT';

const SCHEMA_VERSION = 1;
/** Most items of one bulk request: one atomic Firestore batch. */
export const BULK_MAX_ITEMS = 500;

/**
 * The part of `PdfService` (modules/pdf) that issuance needs: a dry run that tells whether the
 * texts fit the template. Compose passes the real `PdfService`; tests pass a fake. Issuance never
 * renders and never touches Cloud Storage.
 */
export interface FitChecker {
  checkFit(certificate: Certificate, template: Template): Promise<FitResult>;
}

/** Validated issuance request (shapes enforced by the HTTP layer). */
export interface IssueCertificateInput {
  organizationId: string;
  eventId: string;
  type: CertificateType;
  /** Template reference; the latest version of (organization, event, type) when absent. */
  templateId?: string | undefined;
  ownerName: string;
  email?: string | undefined;
  subject: string;
  skills: string[];
  issuedAt?: Date | undefined;
}

/**
 * Bulk issuance request. The envelope is validated by the HTTP layer; `items` are validated
 * per item by the service (strict schema, same normalisation as single issuance).
 */
export interface IssueManyInput {
  organizationId: string;
  eventId: string;
  type: CertificateType;
  templateId?: string | undefined;
  /** Default subject; an item's own `subject` overrides it. */
  subject?: string | undefined;
  items: readonly unknown[];
}

export interface CertificateIssuanceService {
  /**
   * Validates references, checks that the texts fit, stores the certificate (`status: active`,
   * `emailStatus` pending with an address, skipped without) and publishes `certificate.issued`.
   * Throws 422 `EVENT_ORG_MISMATCH`, `TEMPLATE_MISMATCH`, `TEMPLATE_NOT_FOUND` or
   * `TEXT_DOES_NOT_FIT` (nothing is stored then); `NotFoundError` for an unknown organization or event.
   */
  issue(input: IssueCertificateInput, adminUid: string): Promise<Certificate>;
  /**
   * All-or-nothing bulk issuance of 1 to 500 certificates: same reference checks as `issue`
   * (template resolved once), then validates and fit-checks every item. Any problem yields
   * 422 `BULK_INVALID` listing all of them (`items[i].field`, at most 200, `truncated`) and
   * nothing is stored. Otherwise one atomic `createMany`, then `certificate.issued` per
   * certificate in request order. Returns the certificates in request order.
   */
  issueMany(input: IssueManyInput, adminUid: string): Promise<Certificate[]>;
  /** Current time of the service clock (request validation bounds `issuedAt` with it). */
  now(): Date;
}

export interface IssuanceDeps {
  certificates: CertificateRepository;
  organizations: OrganizationService;
  events: EventService;
  templates: TemplateService;
  fitChecker: FitChecker;
  clock: Clock;
  ids: IdGenerator;
  eventBus: EventBus;
}

interface References {
  organizationId: OrganizationId;
  eventId: EventId;
  organizationName: string;
  eventName: string;
}

/** `["skills", 2]` of item 17 -> `items[17].skills[2]`. */
function itemPath(index: number, path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (acc, part) =>
      typeof part === 'number' ? `${acc}[${String(part)}]` : `${acc}.${String(part)}`,
    `items[${String(index)}]`,
  );
}

/** Collects item problems up to the cap; `full` once more than the cap exists. */
class BulkProblems {
  private readonly details: ErrorDetail[] = [];
  private total = 0;

  get full(): boolean {
    return this.total > BULK_INVALID_MAX_DETAILS;
  }

  add(
    index: number,
    path: readonly PropertyKey[],
    message: string,
    code: string | undefined,
  ): void {
    this.total += 1;
    if (this.details.length >= BULK_INVALID_MAX_DETAILS) return;
    this.details.push({
      path: itemPath(index, path),
      message,
      ...(code !== undefined && { code }),
    });
  }

  throwIfAny(): void {
    if (this.total === 0) return;
    throw new BulkInvalidError(this.details, this.total > this.details.length);
  }
}

export class DefaultCertificateIssuanceService implements CertificateIssuanceService {
  constructor(private readonly deps: IssuanceDeps) {}

  now(): Date {
    return this.deps.clock.now();
  }

  async issue(input: IssueCertificateInput, adminUid: string): Promise<Certificate> {
    const { certificates, clock, ids, eventBus, fitChecker } = this.deps;
    const refs = await this.resolveReferences(input.organizationId, input.eventId);
    const template = await this.resolveTemplate(input, refs.organizationId, refs.eventId);

    const now = clock.now();
    const build = (): Certificate => this.buildCertificate(refs, template, adminUid, now, input);

    let certificate = build();
    const fit = await fitChecker.checkFit(certificate, template);
    if (!fit.fits) {
      throw new UnprocessableError(
        TEXT_DOES_NOT_FIT,
        'Some texts do not fit the template',
        fit.issues.map((issue) => ({
          path: issue.field,
          message: issue.message,
          ...(issue.reason !== undefined && { code: issue.reason }),
        })),
      );
    }

    try {
      await certificates.create(certificate);
    } catch (error) {
      // An ID collision is practically impossible; retry once with a fresh ID.
      if (!(error instanceof ConflictError)) throw error;
      certificate = { ...certificate, id: ids.newCertificateId() };
      await certificates.create(certificate);
    }

    await eventBus.publish('certificate.issued', {
      certificateId: certificate.id,
      organizationId: refs.organizationId,
      eventId: refs.eventId,
      hasEmail: certificate.email !== undefined,
      occurredAt: now,
    });
    return certificate;
  }

  async issueMany(input: IssueManyInput, adminUid: string): Promise<Certificate[]> {
    const { certificates, clock, ids, eventBus, fitChecker } = this.deps;
    if (input.items.length < 1 || input.items.length > BULK_MAX_ITEMS) {
      throw new ValidationError(`Between 1 and ${String(BULK_MAX_ITEMS)} items are required`, [
        { path: 'items', message: `Between 1 and ${String(BULK_MAX_ITEMS)} items are required` },
      ]);
    }
    const refs = await this.resolveReferences(input.organizationId, input.eventId);
    // Resolved once; every checkFit call below reuses this template (and so its loaded fonts).
    const template = await this.resolveTemplate(input, refs.organizationId, refs.eventId);

    const now = clock.now();
    const itemSchema = bulkItemSchema(() => now);
    const problems = new BulkProblems();
    let built: Certificate[] = [];
    for (const [index, raw] of input.items.entries()) {
      const parsed = itemSchema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          if (issue.code === 'unrecognized_keys') {
            for (const key of issue.keys) {
              problems.add(index, [...issue.path, key], 'Unknown property', issue.code);
            }
          } else {
            problems.add(index, issue.path, issue.message, issue.code);
          }
        }
        continue;
      }
      const item = parsed.data;
      const subject = item.subject ?? input.subject;
      if (subject === undefined) {
        problems.add(
          index,
          ['subject'],
          'Required: no subject on the item or the request',
          'required',
        );
        continue;
      }
      // More than the cap of problems exist already: the answer is truncated, skip the costly checks.
      if (problems.full) continue;
      const certificate = this.buildCertificate(refs, template, adminUid, now, {
        ...item,
        type: input.type,
        subject,
      });
      const fit = await fitChecker.checkFit(certificate, template);
      if (!fit.fits) {
        for (const issue of fit.issues)
          problems.add(index, [issue.field], issue.message, issue.reason);
        continue;
      }
      built.push(certificate);
    }
    problems.throwIfAny();

    try {
      await certificates.createMany(built);
    } catch (error) {
      // An ID collision is practically impossible; retry once with fresh IDs.
      if (!(error instanceof ConflictError)) throw error;
      built = built.map((c) => ({ ...c, id: ids.newCertificateId() }));
      await certificates.createMany(built);
    }

    for (const certificate of built) {
      await eventBus.publish('certificate.issued', {
        certificateId: certificate.id,
        organizationId: refs.organizationId,
        eventId: refs.eventId,
        hasEmail: certificate.email !== undefined,
        occurredAt: now,
      });
    }
    return built;
  }

  /** Organization and event snapshots; the event must belong to the organization. */
  private async resolveReferences(organizationIdRaw: string, eventIdRaw: string) {
    const { organizations, events } = this.deps;
    const organizationId = asOrganizationId(organizationIdRaw);
    const eventId = asEventId(eventIdRaw);
    const [organizationName, event] = await Promise.all([
      organizations.getSnapshotName(organizationId),
      events.getSnapshot(eventId),
    ]);
    if (event.organizationId !== organizationId) {
      throw new UnprocessableError(
        EVENT_ORG_MISMATCH,
        'The event does not belong to the organization',
        [{ path: 'eventId', message: 'Event belongs to another organization' }],
      );
    }
    return { organizationId, eventId, organizationName, eventName: event.name };
  }

  private buildCertificate(
    refs: References,
    template: Template,
    adminUid: string,
    now: Date,
    fields: Pick<IssueCertificateInput, 'type' | 'ownerName' | 'email' | 'subject' | 'issuedAt'> & {
      skills: string[];
    },
  ): Certificate {
    return {
      id: this.deps.ids.newCertificateId(),
      organizationId: refs.organizationId,
      eventId: refs.eventId,
      organizationName: refs.organizationName,
      eventName: refs.eventName,
      templateId: template.reference,
      type: fields.type,
      ownerName: fields.ownerName,
      ...(fields.email !== undefined && { email: fields.email }),
      subject: fields.subject,
      skills: fields.skills,
      status: 'active',
      issuedAt: fields.issuedAt ?? now,
      emailStatus: emailInitialStatus(fields.email === undefined ? {} : { email: fields.email }),
      emailAttempts: 0,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  private async resolveTemplate(
    input: Pick<IssueCertificateInput, 'templateId' | 'type'>,
    organizationId: OrganizationId,
    eventId: EventId,
  ): Promise<Template> {
    const { templates } = this.deps;
    if (input.templateId === undefined) {
      const latest = await templates.getLatest(organizationId, eventId, input.type);
      if (!latest) {
        throw new UnprocessableError(
          TEMPLATE_NOT_FOUND,
          'No template exists for this organization, event and type',
        );
      }
      return latest;
    }
    let template: Template;
    try {
      template = await templates.get(input.templateId);
    } catch (error) {
      if ((error as { statusCode?: unknown }).statusCode === 404) {
        throw new UnprocessableError(TEMPLATE_NOT_FOUND, 'The template does not exist', [
          { path: 'templateId', message: 'Unknown template' },
        ]);
      }
      throw error;
    }
    const problems: ErrorDetail[] = [];
    if (template.organizationId !== organizationId) {
      problems.push({
        path: 'organizationId',
        message: 'Template belongs to another organization',
      });
    }
    if (template.eventId !== eventId) {
      problems.push({ path: 'eventId', message: 'Template belongs to another event' });
    }
    if (template.type !== input.type) {
      problems.push({ path: 'type', message: 'Template is for another certificate type' });
    }
    if (problems.length > 0) {
      throw new UnprocessableError(
        TEMPLATE_MISMATCH,
        'The template does not match the organization, event and type',
        problems,
      );
    }
    return template;
  }
}
