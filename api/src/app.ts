import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { installAdminGuard } from './http/auth/admin-guard.js';
import { installErrorHandling } from './http/error-handler.js';
import { createLogger, type LogOptions } from './http/logging/logger.js';
import { requestIdFrom } from './http/logging/trace.js';
import { installOpenApi, registerOpenApiEndpoint } from './http/openapi/plugin.js';
import { installRequestContext } from './http/request-context.js';
import { healthRoutes } from './http/routes/health.js';
import { createFeatureFlags, parseFlags, type FeatureFlags } from './flags.js';
import { adminEventRoutes } from './http/routes/admin-events.js';
import { adminOrganizationRoutes } from './http/routes/admin-organizations.js';
import { adminTemplateRoutes } from './http/routes/admin-templates.js';
import { adminCertificateRevocationRoutes } from './http/routes/admin-certificate-revocation.js';
import { adminMeRoutes } from './http/routes/admin-me.js';
import { publicCertificateRoutes } from './http/routes/public-certificates.js';
import type { PublicUrls } from './http/dto/public/certificate.js';
import { adminCertificateRoutes } from './http/routes/admin-certificates.js';
import { buildServices } from './services.js';
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
}

const BODY_LIMIT_BYTES = 1024 * 1024;
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
    // Fastify answers 414 above 100 characters; long path parameters must reach validation (404).
    maxParamLength: 512,
    // Cloud Run terminates TLS behind a single Google front end hop.
    // Final value is decided in BEU-ICT/certificate-manager#176.
    trustProxy: (_address, hop) => hop < TRUSTED_PROXY_HOPS,
  };
  const app = Fastify(options);

  installRequestContext(app, { gcpProject: deps.log?.gcpProject });
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
    adminTemplateRoutes(app, services);
    publicCertificateRoutes(app, services, deps.publicUrls ?? DEFAULT_PUBLIC_URLS);
    adminCertificateRoutes(app, services, deps.publicUrls ?? DEFAULT_PUBLIC_URLS);
    adminCertificateRevocationRoutes(app, services);
  }
  if (deps.openApiEndpoint === true) registerOpenApiEndpoint(app);

  return app;
}
