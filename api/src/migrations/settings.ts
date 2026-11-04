import type { Config } from '../config.js';
import type { MigrationSettings } from './types.js';

export function migrationSettings(config: Config): MigrationSettings {
  return {
    bootstrapAdminEmail: config.bootstrapAdminEmail,
    publicBaseUrl: config.publicBaseUrl,
    mail: { from: config.email.fromAddress, replyTo: config.email.replyTo },
  };
}
