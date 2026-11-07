import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Cursor } from '../../ports/common.js';
import type { Services } from '../../wiring.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  ReferenceParamsDto,
  TemplateDetailDto,
  TemplateListQueryDto,
  TemplatePageDto,
  toTemplateDetailDto,
  toTemplateDto,
} from '../dto/admin/template.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** `/api/v1/admin/templates`: list and get (uploads are added by the upload story). */
export function adminTemplateRoutes(app: FastifyInstance, services: Services): void {
  const { templates } = services;

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    r.get(
      '/templates',
      {
        schema: {
          operationId: 'listTemplates',
          summary: 'List template versions (newest first, cursor pagination)',
          description:
            'Filters `organizationId`, `eventId`, `type` combine with AND; an unknown organization or event yields an empty page.',
          security: SECURITY,
          querystring: TemplateListQueryDto,
          response: {
            200: jsonResponse('A page of templates', TemplatePageDto),
            ...errorResponses(400, 401, 403),
          },
        },
      },
      async (request) => {
        const { organizationId, eventId, type, limit, cursor } = request.query;
        const page = await templates.listWithLatest(
          {
            ...(organizationId !== undefined && { organizationId }),
            ...(eventId !== undefined && { eventId }),
            ...(type !== undefined && { type }),
          },
          {
            ...(limit !== undefined && { limit }),
            ...(cursor !== undefined && { cursor: cursor as Cursor }),
          },
        );
        return { items: page.items.map(toTemplateDto), nextCursor: page.nextCursor };
      },
    );

    r.get(
      '/templates/:reference',
      {
        schema: {
          operationId: 'getTemplate',
          summary: 'Get a template version with config, files and certificate count',
          description: 'Unknown and malformed references are both 404.',
          security: SECURITY,
          params: ReferenceParamsDto,
          response: {
            200: jsonResponse('The template', TemplateDetailDto),
            ...errorResponses(401, 403, 404),
          },
        },
      },
      async (request) => toTemplateDetailDto(await templates.getDetail(request.params.reference)),
    );
  });
}
