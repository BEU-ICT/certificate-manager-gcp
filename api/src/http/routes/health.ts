import type { FastifyPluginCallback } from 'fastify';

/** Liveness probe. Deliberately makes no dependency calls (no Firestore read). */
export const healthRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/internal/healthz', () => ({ status: 'ok' }));
  done();
};
