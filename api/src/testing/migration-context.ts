import type { MigrationContext, MigrationSettings } from '../migrations/index.js';
import type { Fakes } from './fakes/create-fakes.js';

export const TEST_MIGRATION_SETTINGS: MigrationSettings = {
  bootstrapAdminEmail: 'first-admin@example.test',
  publicBaseUrl: 'https://app.example.test',
  mail: { from: 'certificates@example.test' },
};

/** A migration context over the fakes; the logger is silent unless supplied. */
export function createMigrationContext(
  fakes: Fakes,
  overrides: Partial<MigrationContext> = {},
): MigrationContext {
  return {
    clock: fakes.clock,
    organizations: fakes.organizations,
    events: fakes.events,
    templates: fakes.templates,
    certificates: fakes.certificates,
    emailSender: fakes.emailSender,
    adminUsers: fakes.adminUsers,
    settings: TEST_MIGRATION_SETTINGS,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    ...overrides,
  };
}
