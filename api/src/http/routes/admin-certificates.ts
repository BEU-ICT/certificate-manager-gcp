import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Cursor } from '../../ports/common.js';
import type { Services } from '../../wiring.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  AdminCertificateDto,
  AdminCertificatePageDto,
  CertificateCountDto,
  CertificateCountQueryDto,
  CertificateIdParamsDto,
  CertificateListQueryDto,
  toAdminCertificateDto,
  toAdminCertificateSummaryDto,
  toCertificateFilter,
  type CertificateUrls,
} from '../dto/admin/certificate.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** `/api/v1/admin/certificates`: list, count and detail (read side). */
export function adminCertificateRoutes(
  app: FastifyInstance,
  services: Services,
  urls: CertificateUrls,
): void {
  const { certificateQueries } = services;

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    r.get(
      '/certificates',
      {
        schema: {
          operationId: 'listCertificates',
          summary: 'List certificates (newest first, cursor pagination, filters)',
          description:
            'Filters are ANDed. Summaries never contain the e-mail address (only `hasEmail`). Ordered by `issuedAt` descending, then `id` descending.',
          security: SECURITY,
          querystring: CertificateListQueryDto,
          response: {
            200: jsonResponse('A page of certificate summaries', AdminCertificatePageDto),
            ...errorResponses(400, 401, 403),
          },
        },
      },
      async (request) => {
        const { limit, cursor, ...filters } = request.query;
        const page = await certificateQueries.list(toCertificateFilter(filters), {
          ...(limit !== undefined && { limit }),
          ...(cursor !== undefined && { cursor: cursor as Cursor }),
        });
        return {
          items: page.items.map(toAdminCertificateSummaryDto),
          nextCursor: page.nextCursor,
        };
      },
    );

    r.get(
      '/certificates/count',
      {
        schema: {
          operationId: 'countCertificates',
          summary: 'Count certificates matching the filters',
          description:
            'Uses the native aggregation query: one read per 1,000 index entries, no documents are read.',
          security: SECURITY,
          querystring: CertificateCountQueryDto,
          response: {
            200: jsonResponse('The number of matching certificates', CertificateCountDto),
            ...errorResponses(400, 401, 403),
          },
        },
      },
      async (request) => ({
        count: await certificateQueries.count(toCertificateFilter(request.query)),
      }),
    );

    r.get(
      '/certificates/:id',
      {
        schema: {
          operationId: 'getCertificate',
          summary: 'Get a certificate (admin detail)',
          description:
            'All fields including the e-mail address, `publicUrl` and `pdfUrl`. Malformed and unknown ids both yield 404. The storage object name (`pdfPath`) is never returned.',
          security: SECURITY,
          params: CertificateIdParamsDto,
          response: {
            200: jsonResponse('The certificate', AdminCertificateDto),
            ...errorResponses(401, 403, 404),
          },
        },
      },
      async (request) =>
        toAdminCertificateDto(await certificateQueries.get(request.params.id), urls),
    );
  });
}
