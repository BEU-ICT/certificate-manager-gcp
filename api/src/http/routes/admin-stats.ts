import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UnauthenticatedError } from '../../shared/errors.js';
import type { Services } from '../../wiring.js';
import { adminRoutes } from '../auth/admin-guard.js';
import { AdminStatsDto, StatsQueryDto } from '../dto/admin/stats.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** `GET /api/v1/admin/stats`: dashboard counts (aggregation queries, cached). */
export function adminStatsRoutes(app: FastifyInstance, services: Services): void {
  const { stats } = services;

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    r.get(
      '/stats',
      {
        schema: {
          operationId: 'getAdminStats',
          summary: 'Dashboard counts',
          description:
            'Computed with native count aggregations only (no documents are read) and cached in memory per instance (`STATS_CACHE_SECONDS`, default 60); concurrent requests share one computation. `refresh=true` bypasses the cache but is limited to once per 10 seconds per administrator (`429 RATE_LIMITED` with `Retry-After`).',
          security: SECURITY,
          querystring: StatsQueryDto,
          response: {
            200: jsonResponse('The statistics', AdminStatsDto),
            ...errorResponses(400, 401, 403, 429),
          },
        },
      },
      (request) => {
        // The guard always sets `admin`; a missing principal must never reach the service.
        if (!request.admin) throw new UnauthenticatedError();
        return stats.get({ refresh: request.query.refresh, adminUid: request.admin.uid });
      },
    );
  });
}
