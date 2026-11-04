import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import { buildAdminFeatures, type FeatureFlags } from '../../flags.js';
import { adminRoutes } from '../auth/admin-guard.js';
import { AdminMeDto } from '../dto/admin/me.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

/** `GET /api/v1/admin/me`: lets the SPA confirm that the signed-in Firebase user is an administrator. */
export function adminMeRoutes(app: FastifyInstance, flags: FeatureFlags): void {
  adminRoutes(app, (scope) => {
    scope.withTypeProvider<ZodTypeProvider>().get(
      '/me',
      {
        schema: {
          operationId: 'getAdminMe',
          summary: 'Current administrator',
          description: 'Requires a Firebase ID token with the `role=admin` claim.',
          security: [{ bearerAuth: [] }],
          response: {
            200: jsonResponse('The authenticated administrator', AdminMeDto),
            ...errorResponses(401, 403),
          },
        },
      },
      (request, reply) => {
        // The guard guarantees `request.admin`; no database access here.
        const admin = request.admin;
        if (!admin) throw new Error('admin guard did not run');
        void reply.header('cache-control', 'no-store');
        return {
          uid: admin.uid,
          email: admin.email,
          role: 'admin' as const,
          features: buildAdminFeatures(flags),
        };
      },
    );
  });
}
