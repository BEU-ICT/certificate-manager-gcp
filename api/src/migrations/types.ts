import type {
  AdminUserDirectory,
  CertificateRepository,
  Clock,
  EmailSender,
  EventRepository,
  OrganizationRepository,
  TemplateRepository,
} from '../ports/index.js';

/** Minimal structured logger; a pino logger satisfies it. */
export interface MigrationLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Configuration values migrations may need (a subset of `Config`, never secrets). */
export interface MigrationSettings {
  /** E-mail of the first administrator; empty when none is configured. */
  readonly bootstrapAdminEmail: string;
  /** Base URL of the web app, used in links shown to the user. */
  readonly publicBaseUrl: string;
  readonly mail: { readonly from: string; readonly replyTo?: string | undefined };
}

/**
 * Thrown by a migration that could not run yet for a benign reason (for example no configuration).
 * The runner releases the marker, logs the message and continues; the migration runs again on
 * the next start.
 */
export class MigrationDeferred extends Error {
  override readonly name = 'MigrationDeferred';
}

/** What a migration may touch: ports only, never vendor SDKs. */
export interface MigrationContext {
  readonly clock: Clock;
  readonly organizations: OrganizationRepository;
  readonly events: EventRepository;
  readonly templates: TemplateRepository;
  readonly certificates: CertificateRepository;
  readonly emailSender: EmailSender;
  readonly adminUsers: AdminUserDirectory;
  readonly settings: MigrationSettings;
  readonly log: MigrationLogger;
}

/**
 * A one-off, ordered data change. `id` is `NNN-kebab-name` and is also the file name
 * (`src/migrations/NNN-kebab-name.ts`). `run` must be idempotent: it can run again when
 * the marker could not be written or removed after it ran.
 */
export interface Migration {
  readonly id: string;
  readonly description: string;
  run(ctx: MigrationContext): Promise<void>;
}
