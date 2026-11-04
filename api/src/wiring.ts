import type {
  CertificateRepository,
  EmailSender,
  EventRepository,
  OrganizationRepository,
  Scheduler,
  StorageGateway,
  TaskQueue,
  TaskRequestVerifier,
  TemplateRepository,
  TokenVerifier,
} from './ports/index.js';

/**
 * Types of the dependency bag that the composition root (compose.ts) hands to buildApp().
 * Kept separate from compose.ts so that app.ts and tests can use them without importing it.
 */

/** Result of the `DB_ADAPTER` selection. */
export interface RepositoryPorts {
  readonly organizations: OrganizationRepository;
  readonly events: EventRepository;
  readonly templates: TemplateRepository;
  readonly certificates: CertificateRepository;
}

/** Result of the `QUEUE_ADAPTER` selection. */
export interface QueuePorts {
  readonly taskQueue: TaskQueue;
  readonly scheduler: Scheduler;
}

/** Result of the `AUTH_PROVIDER` selection. */
export interface AuthPorts {
  readonly tokenVerifier: TokenVerifier;
  readonly taskRequestVerifier: TaskRequestVerifier;
}

/** All ports selected by configuration. */
export interface Ports {
  readonly repositories: RepositoryPorts;
  readonly storage: StorageGateway;
  readonly queue: QueuePorts;
  readonly auth: AuthPorts;
  readonly email: EmailSender;
  /** Present when EMAIL_FALLBACK_PROVIDER is set and FEATURE_EMAIL_FALLBACK is on. */
  readonly emailFallback?: EmailSender;
}

/** Module services, constructed in compose.ts from ports. Modules add their services here. */
export type Services = Record<string, never>;
