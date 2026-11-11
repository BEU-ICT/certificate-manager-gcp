import type { CertificateRepository, Clock, EventBus, IdGenerator } from '../../ports/index.js';
import type { Certificate, Template } from '../../shared/domain.js';
import type { CertificateType } from '../../shared/certificate-types.js';
import { ConflictError, UnprocessableError, type ErrorDetail } from '../../shared/errors.js';
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

export const TEMPLATE_MISMATCH = 'TEMPLATE_MISMATCH';
export const TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND';
export const EVENT_ORG_MISMATCH = 'EVENT_ORG_MISMATCH';
export const TEXT_DOES_NOT_FIT = 'TEXT_DOES_NOT_FIT';

const SCHEMA_VERSION = 1;

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

export interface CertificateIssuanceService {
  /**
   * Validates references, checks that the texts fit, stores the certificate (`status: active`,
   * `emailStatus` pending with an address, skipped without) and publishes `certificate.issued`.
   * Throws 422 `EVENT_ORG_MISMATCH`, `TEMPLATE_MISMATCH`, `TEMPLATE_NOT_FOUND` or
   * `TEXT_DOES_NOT_FIT` (nothing is stored then); `NotFoundError` for an unknown organization or event.
   */
  issue(input: IssueCertificateInput, adminUid: string): Promise<Certificate>;
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

export class DefaultCertificateIssuanceService implements CertificateIssuanceService {
  constructor(private readonly deps: IssuanceDeps) {}

  now(): Date {
    return this.deps.clock.now();
  }

  async issue(input: IssueCertificateInput, adminUid: string): Promise<Certificate> {
    const { organizations, events, certificates, clock, ids, eventBus, fitChecker } = this.deps;
    const organizationId = asOrganizationId(input.organizationId);
    const eventId = asEventId(input.eventId);

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

    const template = await this.resolveTemplate(input, organizationId, eventId);

    const now = clock.now();
    const build = (): Certificate => ({
      id: ids.newCertificateId(),
      organizationId,
      eventId,
      organizationName,
      eventName: event.name,
      templateId: template.reference,
      type: input.type,
      ownerName: input.ownerName,
      ...(input.email !== undefined && { email: input.email }),
      subject: input.subject,
      skills: input.skills,
      status: 'active',
      issuedAt: input.issuedAt ?? now,
      emailStatus: emailInitialStatus(input.email === undefined ? {} : { email: input.email }),
      emailAttempts: 0,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now,
      schemaVersion: SCHEMA_VERSION,
    });

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
      organizationId,
      eventId,
      hasEmail: certificate.email !== undefined,
      occurredAt: now,
    });
    return certificate;
  }

  private async resolveTemplate(
    input: IssueCertificateInput,
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
