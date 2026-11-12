import type {
  CertificateIssuanceService,
  CertificateQueryService,
  CertificateService,
  RevocationService,
} from './modules/certificates/index.js';
import type { EmailResendService } from './modules/notifications/index.js';
import type { PdfService, PublicPdfService } from './modules/pdf/index.js';
import type { StatsService } from './modules/stats/index.js';
import type { EventService } from './modules/events/index.js';
import type { TemplateAssets, TemplateService } from './modules/templates/index.js';
import type { OrganizationService } from './modules/organizations/index.js';
import type { ReferenceCheckRegistry } from './shared/references.js';
import type {
  AdminUserDirectory,
  CertificateRepository,
  Clock,
  EmailQuotaStore,
  EmailSender,
  EventBus,
  EventRepository,
  IdGenerator,
  IdempotencyStore,
  MigrationStateStore,
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
  readonly migrationState: MigrationStateStore;
  readonly idempotency: IdempotencyStore;
  readonly emailQuota: EmailQuotaStore;
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
  readonly adminUsers: AdminUserDirectory;
}

/** Every port the application depends on, supplied by the composition root (or the test context). */
export interface Ports {
  clock: Clock;
  ids: IdGenerator;
  organizations: OrganizationRepository;
  events: EventRepository;
  templates: TemplateRepository;
  certificates: CertificateRepository;
  migrationState: MigrationStateStore;
  idempotency: IdempotencyStore;
  emailQuota: EmailQuotaStore;
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
  adminUsers: AdminUserDirectory;
}

/** Module services, constructed by `buildServices` (services.ts) from ports. Modules add theirs here. */
export interface Services {
  readonly organizations: OrganizationService;
  /** Modules that reference organizations register their checkers here (services.ts). */
  readonly organizationReferences: ReferenceCheckRegistry;
  readonly events: EventService;
  /** Templates and certificates register their event checkers here (services.ts). */
  readonly eventReferences: ReferenceCheckRegistry;
  readonly templates: TemplateService;
  /** Cached loader of template packages for rendering (templates module). */
  readonly templateAssets: TemplateAssets;
  /** Certificates module (public lookup now; issuance and admin APIs follow in the certificates epic). */
  readonly certificates: CertificateService;
  /** Admin resend of the certificate e-mail (notifications module). */
  readonly emailResend: EmailResendService;
  /** Idempotency-Key records for `withIdempotency` (http/idempotency.ts). */
  readonly idempotency: IdempotencyStore;
  /** Admin read side of certificates: list, count, detail (certificates module). */
  readonly certificateQueries: CertificateQueryService;
  /** Certificate revocation (certificates module). */
  readonly revocation: RevocationService;
  /** Cached dashboard counts (stats module). */
  readonly stats: StatsService;
  /** PDF rendering and admin previews (pdf module). */
  readonly pdf: PdfService;
  /** On-demand public PDF generation and lookup (pdf module). */
  readonly publicPdf: PublicPdfService;
  /** Single issuance; present only when `buildServices` got a `fitChecker` (see certificates README). */
  readonly issuance?: CertificateIssuanceService;
}
