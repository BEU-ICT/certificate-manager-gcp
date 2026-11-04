import { DefaultEventService } from './modules/events/index.js';
import { DefaultOrganizationService } from './modules/organizations/index.js';
import { ReferenceCheckRegistry } from './shared/references.js';
import type { Ports, Services } from './wiring.js';

/**
 * Builds the module services from ports. Each module adds its service here; cross-module
 * reference checks (who may veto a delete) are registered on the shared registries below,
 * never inside the modules themselves. Templates and certificates register their checkers on
 * `eventReferences` (and `organizationReferences`) when their services exist.
 */
export function buildServices(ports: Ports): Services {
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
  return { organizations, organizationReferences, events, eventReferences };
}
