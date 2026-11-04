import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { installErrorHandling } from './http/error-handler.js';
import { createLogger, type LogOptions } from './http/logging/logger.js';
import { requestIdFrom } from './http/logging/trace.js';
import { installOpenApi, registerOpenApiEndpoint } from './http/openapi/plugin.js';
import { installRequestContext } from './http/request-context.js';
import { healthRoutes } from './http/routes/health.js';
import type { FeatureFlags } from './flags.js';
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
  installOpenApi(app);

  void app.register(healthRoutes);
  if (deps.openApiEndpoint === true) registerOpenApiEndpoint(app);

  return app;
}
