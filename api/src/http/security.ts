import type { FastifyInstance, FastifyReply } from 'fastify';

/** Fixed headers for JSON API responses; the API never serves HTML, so everything is denied. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/** Longest accepted request URL (path and query), in characters. */
export const MAX_URL_LENGTH = 2048;

/**
 * Response hardening for the API (BEU-ICT/certificate-manager#384): security headers on every
 * response, `Cache-Control: no-store` unless the route chose a policy, and a URL length limit.
 * No CORS plugin is registered on purpose: the SPA and the API share an origin behind Hosting.
 * A plain hook instead of @fastify/helmet keeps the dependency list (and the Docker lockfile)
 * unchanged and costs a few header writes per response.
 */
export function installSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    if (request.raw.url !== undefined && request.raw.url.length > MAX_URL_LENGTH) {
      void reply.status(414).send({
        error: {
          code: 'URI_TOO_LONG',
          message: 'The request URL is too long',
          requestId: request.id,
        },
      });
      return;
    }
    done();
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    applySecurityHeaders(reply);
    done(null, payload);
  });
}

/** The header set of every response; also called where `onSend` hooks do not run. */
export function applySecurityHeaders(reply: FastifyReply): void {
  void reply.headers(SECURITY_HEADERS);
  if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
  void reply.removeHeader('x-powered-by');
  void reply.removeHeader('server');
}
