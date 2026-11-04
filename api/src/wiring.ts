import type {
  CertificateRepository,
  Clock,
  EmailSender,
  EventBus,
  EventRepository,
  IdGenerator,
  OrganizationRepository,
  RateLimiter,
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

/** Every port the application depends on, supplied by the composition root (or the test context). */
export interface Ports {
  clock: Clock;
  ids: IdGenerator;
  organizations: OrganizationRepository;
  events: EventRepository;
  templates: TemplateRepository;
  certificates: CertificateRepository;
  storage: StorageGateway;
  taskQueue: TaskQueue;
  scheduler: Scheduler;
  emailSender: EmailSender;
  /** Present when EMAIL_FALLBACK_PROVIDER is set and FEATURE_EMAIL_FALLBACK is on. */
  emailFallback?: EmailSender;
  rateLimiter: RateLimiter;
  eventBus: EventBus;
  tokenVerifier: TokenVerifier;
  taskRequestVerifier: TaskRequestVerifier;
}

/** Module services, constructed in compose.ts from ports. Modules add their services here. */
export type Services = Record<string, never>;
