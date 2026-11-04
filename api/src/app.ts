import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './http/routes/health.js';

export interface AppDeps {
  logger?: FastifyServerOptions['logger'];
}

const BODY_LIMIT_BYTES = 1024 * 1024;
const TRUSTED_PROXY_HOPS = 1;

/** Pure factory: no side effects at import time, no environment access. */
export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const options: FastifyServerOptions = {
    logger: deps.logger ?? false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Cloud Run terminates TLS behind a single Google front end hop.
    // Final value is decided in BEU-ICT/certificate-manager#176.
    trustProxy: (_address, hop) => hop < TRUSTED_PROXY_HOPS,
  };
  const app = Fastify(options);

  void app.register(healthRoutes);

  return app;
}
