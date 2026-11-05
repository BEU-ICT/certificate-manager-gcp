import { DefaultEventService } from './modules/events/index.js';
import { DefaultOrganizationService } from './modules/organizations/index.js';
import {
  DefaultTemplateService,
  type TemplateCertificateCounter,
} from './modules/templates/index.js';
import { ReferenceCheckRegistry } from './shared/references.js';
import type { EventId, OrganizationId } from './shared/ids.js';
import type { Ports, Services } from './wiring.js';

/**
 * Builds the module services from ports. Each module adds its service here; cross-module
 * reference checks (who may veto a delete) are registered on the shared registries below,
 * never inside the modules themselves. Templates and certificates register their checkers on
 * `eventReferences` (and `organizationReferences`) when their services exist.
 */
/**
 * Note for E7: pass the real certificate counter (certificates by `templateId`) as the second
 * argument; until then templates report `certificateCount` 0.
 */
export function buildServices(
  ports: Ports,
  /** Certificates epic (E7) passes its counter here; templates report 0 certificates until then. */
  templateCertificateCounter?: TemplateCertificateCounter,
): Services {
  const organizationReferences = new ReferenceCheckRegistry();
  const eventReferences = new ReferenceCheckRegistry();
  const organizations = new DefaultOrganizationService(
    ports.organizations,
    ports.clock,
    ports.ids,
    organizationReferences,
  );
  const events = new DefaultEventService(
    ports.events,
    organizations,
    ports.clock,
    ports.ids,
    eventReferences,
  );
  organizationReferences.register({
    name: 'events',
    countReferences: (organizationId) => events.countByOrganization(organizationId),
  });
  const templates = new DefaultTemplateService(
    ports.templates,
    ports.storage,
    ports.clock,
    templateCertificateCounter,
  );
  organizationReferences.register({
    name: 'templates',
    countReferences: (organizationId) => templates.countByOrganization(organizationId),
  });
  eventReferences.register({
    name: 'templates',
    countReferences: (eventId) => templates.countByEvent(eventId),
  });
  organizationReferences.register({
    name: 'certificates',
    countReferences: (organizationId) =>
      ports.certificates.countByOrganization(organizationId as OrganizationId),
  });
  eventReferences.register({
    name: 'certificates',
    countReferences: (eventId) => ports.certificates.countByEvent(eventId as EventId),
  });
  return { organizations, organizationReferences, events, eventReferences, templates };
}
