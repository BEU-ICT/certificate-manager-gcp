import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { installAdminGuard } from './http/auth/admin-guard.js';
import { frameworkErrorHandler, installErrorHandling } from './http/error-handler.js';
import { createLogger, type LogOptions } from './http/logging/logger.js';
import { requestIdFrom } from './http/logging/trace.js';
import { installOpenApi, registerOpenApiEndpoint } from './http/openapi/plugin.js';
import { installRequestContext } from './http/request-context.js';
import { healthRoutes } from './http/routes/health.js';
import { createFeatureFlags, parseFlags, type FeatureFlags } from './flags.js';
import { adminEventRoutes } from './http/routes/admin-events.js';
import { adminOrganizationRoutes } from './http/routes/admin-organizations.js';
import { adminTemplateRoutes } from './http/routes/admin-templates.js';
import { adminCertificateIssuanceRoutes } from './http/routes/admin-certificate-issuance.js';
import { adminCertificateBulkIssuanceRoutes } from './http/routes/admin-certificate-bulk-issuance.js';
import { adminCertificateRevocationRoutes } from './http/routes/admin-certificate-revocation.js';
import { adminMeRoutes } from './http/routes/admin-me.js';
import { publicCertificateRoutes } from './http/routes/public-certificates.js';
import { publicCertificatePdfRoutes } from './http/routes/public-certificate-pdf.js';
import type { PublicUrls } from './http/dto/public/certificate.js';
import { installSecurity } from './http/security.js';
import { adminCertificateRoutes } from './http/routes/admin-certificates.js';
import { internalSendEmailRoutes } from './http/routes/internal-send-email.js';
import { adminStatsRoutes } from './http/routes/admin-stats.js';
import { buildServices } from './services.js';
import { createSendEmailHandler } from './modules/notifications/index.js';
import type { Ports, Services } from './wiring.js';

export interface AppDeps {
  /** Logging settings; the composition root passes LOG_LEVEL / GCP_PROJECT. Defaults to silent. */
  log?: LogOptions;
  /** Ports and module services built by the composition root (compose.ts); tests pass fakes. */
  ports?: Ports;
  services?: Services;
  /** Serve `GET /internal/openapi.json` (config.openApiEndpoint). Defaults to off. */
  openApiEndpoint?: boolean;
  /** Feature flags (flags.ts); route modules guard endpoints with http/flag-guard.ts. */
  flags?: FeatureFlags;
  /** Pre-authentication requests per minute and IP on admin routes (config.rateLimit.adminPerMin). */
  adminRateLimitPerMin?: number;
  /** Bases for public PDF links (config.publicBaseUrl / pdfPublicBaseUrl); defaults to the local-dev values. */
  publicUrls?: PublicUrls;
  /**
   * Send-email task handler shared with the in-process queue (built by compose.ts). Without it a
   * default handler (placeholder sender address) is built from `ports`; used by tests.
   */
  sendEmail?: SendEmailHandler;
}

export type SendEmailHandler = ReturnType<typeof createSendEmailHandler>;

const BODY_LIMIT_BYTES = 1024 * 1024;
const MAX_PARAM_LENGTH = 128;
const MAX_HEADER_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 55_000;
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const TRUSTED_PROXY_HOPS = 1;
const DEFAULT_PUBLIC_URLS: PublicUrls = {
  publicBaseUrl: 'http://localhost:5173',
  pdfPublicBaseUrl: 'http://localhost:8080',
};

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
    // Longer path parameters are rejected by the router (404) before any handler logic runs.
    maxParamLength: MAX_PARAM_LENGTH,
    // Google's front end keeps connections for 60 s: stay above it; requests end before its 60 s limit.
    connectionTimeout: REQUEST_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    frameworkErrors: frameworkErrorHandler,
    // Cloud Run terminates TLS behind a single Google front end hop.
    // Final value is decided in BEU-ICT/certificate-manager#388.
    trustProxy: (_address, hop) => hop < TRUSTED_PROXY_HOPS,
  };
  const app = Fastify({ ...options, http: { maxHeaderSize: MAX_HEADER_BYTES } });

  installRequestContext(app, { gcpProject: deps.log?.gcpProject });
  installSecurity(app);
  installErrorHandling(app);
  installOpenApi(app);
  installAdminGuard(app, {
    tokenVerifier: deps.ports?.tokenVerifier,
    rateLimiter: deps.ports?.rateLimiter,
    preAuthRequestsPerMin: deps.adminRateLimitPerMin,
    now: deps.ports ? () => deps.ports!.clock.now().getTime() : undefined,
  });

  void app.register(healthRoutes);
  adminMeRoutes(app, deps.flags ?? createFeatureFlags(parseFlags({}, true).flags));
  const services = deps.services ?? (deps.ports ? buildServices(deps.ports) : undefined);
  if (services) {
    adminOrganizationRoutes(app, services);
    adminEventRoutes(app, services);
    adminTemplateRoutes(app, services, {
      publicBaseUrl: (deps.publicUrls ?? DEFAULT_PUBLIC_URLS).publicBaseUrl,
      ...(deps.ports && { clock: deps.ports.clock }),
    });
    publicCertificateRoutes(app, services, deps.publicUrls ?? DEFAULT_PUBLIC_URLS);
    publicCertificatePdfRoutes(app, services, deps.publicUrls ?? DEFAULT_PUBLIC_URLS, deps.flags);
    adminCertificateRoutes(app, services, deps.publicUrls ?? DEFAULT_PUBLIC_URLS);
    adminCertificateRevocationRoutes(app, services);
    if (services.issuance) {
      adminCertificateIssuanceRoutes(app, services, deps.publicUrls ?? DEFAULT_PUBLIC_URLS);
      adminCertificateBulkIssuanceRoutes(app, services, deps.flags);
    }
    adminStatsRoutes(app, services);
    if (deps.ports) {
      internalSendEmailRoutes(app, {
        verifier: deps.ports.taskRequestVerifier,
        rateLimiter: deps.ports.rateLimiter,
        handle:
          deps.sendEmail ??
          createSendEmailHandler({
            certificates: services.certificates,
            emailSender: deps.ports.emailSender,
            logger: app.log,
            publicBaseUrl: (deps.publicUrls ?? DEFAULT_PUBLIC_URLS).publicBaseUrl,
            from: { address: 'certificates@example.com' },
          }),
        now: () => deps.ports!.clock.now().getTime(),
      });
    }
  }
  if (deps.openApiEndpoint === true) registerOpenApiEndpoint(app);

  return app;
}
