import {
  DefaultOrganizationService,
  ReferenceCheckRegistry,
} from './modules/organizations/index.js';
import type { Ports, Services } from './wiring.js';

/**
 * Builds the module services from ports. Each module adds its service here; cross-module
 * reference checks (who may veto a delete) are registered on the shared registries below,
 * never inside the modules themselves.
 */
export function buildServices(ports: Ports): Services {
  const organizationReferences = new ReferenceCheckRegistry();
  const organizations = new DefaultOrganizationService(
    ports.organizations,
    ports.clock,
    ports.ids,
    organizationReferences,
  );
  return { organizations, organizationReferences };
}
