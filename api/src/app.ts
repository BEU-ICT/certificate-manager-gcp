import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { installErrorHandling } from './http/error-handler.js';
import { createLogger, type LogOptions } from './http/logging/logger.js';
import { requestIdFrom } from './http/logging/trace.js';
import { installRequestContext } from './http/request-context.js';
import { healthRoutes } from './http/routes/health.js';
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

/** Every port the application depends on, supplied by the composition root (or test context). */
export interface AppPorts {
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
  rateLimiter: RateLimiter;
  eventBus: EventBus;
  tokenVerifier: TokenVerifier;
  taskRequestVerifier: TaskRequestVerifier;
}

export interface AppDeps {
  /** Port implementations; consumed by service composition (BEU-ICT/certificate-manager#35). */
  ports?: AppPorts;
  /** Logging settings; the composition root passes LOG_LEVEL / GCP_PROJECT. Defaults to silent. */
  log?: LogOptions;
}

const BODY_LIMIT_BYTES = 1024 * 1024;
const TRUSTED_PROXY_HOPS = 1;

/** Pure factory: no side effects at import time, no environment access. */
export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const options: FastifyServerOptions = {
    loggerInstance: createLogger(deps.log ?? { level: 'silent' }),
    // The access log is written by our own onResponse hook.
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'requestId',
    }),
    genReqId: (req) => requestIdFrom(req.headers['x-cloud-trace-context']),
    bodyLimit: BODY_LIMIT_BYTES,
    // Cloud Run terminates TLS behind a single Google front end hop.
    // Final value is decided in BEU-ICT/certificate-manager#176.
    trustProxy: (_address, hop) => hop < TRUSTED_PROXY_HOPS,
  };
  const app = Fastify(options);

  installRequestContext(app, { gcpProject: deps.log?.gcpProject });
  installErrorHandling(app);

  void app.register(healthRoutes);

  return app;
}
