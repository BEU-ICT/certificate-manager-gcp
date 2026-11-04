import type {
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
  error(obj: Record<string, unknown>, msg: string): void;
}

/** What a migration may touch: ports only, never vendor SDKs. */
export interface MigrationContext {
  readonly clock: Clock;
  readonly organizations: OrganizationRepository;
  readonly events: EventRepository;
  readonly templates: TemplateRepository;
  readonly certificates: CertificateRepository;
  readonly emailSender: EmailSender;
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
