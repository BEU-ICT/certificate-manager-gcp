import type { FastifyInstance } from 'fastify';
import { parseTraceId, traceField } from './logging/trace.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook (later task) once the Firebase token is verified. */
    adminUid?: string;
  }
}

export interface RequestContextOptions {
  gcpProject?: string | undefined;
}

/**
 * X-Request-Id header, trace-correlated child logger and the one-line access log. The request
 * logger already carries `requestId` (`requestIdLogLabel` in app.ts): never add it again.
 */
export function installRequestContext(app: FastifyInstance, options: RequestContextOptions): void {
  app.decorateRequest('adminUid');

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    const traceId = parseTraceId(request.headers['x-cloud-trace-context']);
    if (options.gcpProject && traceId) {
      request.log = request.log.child({
        'logging.googleapis.com/trace': traceField(options.gcpProject, traceId),
      });
    }
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? '(unmatched)',
        status: reply.statusCode,
        latencyMs: Math.round(reply.elapsedTime * 1000) / 1000,
        ...(request.adminUid !== undefined && { adminUid: request.adminUid }),
      },
      'request completed',
    );
    done();
  });
}
