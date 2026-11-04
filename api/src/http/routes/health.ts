import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { HealthDto } from '../dto/public/health.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

/** Liveness probe. Deliberately makes no dependency calls (no Firestore read). */
export const healthRoutes: FastifyPluginCallbackZod = (app, _opts, done) => {
  app.get(
    '/internal/healthz',
    {
      schema: {
        operationId: 'getHealth',
        summary: 'Liveness probe',
        response: { 200: jsonResponse('Service is up', HealthDto), ...errorResponses() },
      },
    },
    () => ({ status: 'ok' as const }),
  );
  done();
};
