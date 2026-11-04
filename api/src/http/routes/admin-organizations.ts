import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Cursor } from '../../ports/common.js';
import type { Services } from '../../wiring.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  CreateOrganizationBodyDto,
  IdParamsDto,
  OrganizationDto,
  OrganizationPageDto,
  RenameOrganizationBodyDto,
  toOrganizationDto,
} from '../dto/admin/organization.js';
import { PageQueryDto } from '../dto/admin/page.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** `/api/v1/admin/organizations`: create, list, get, rename and (when unreferenced) delete. */
export function adminOrganizationRoutes(app: FastifyInstance, services: Services): void {
  const { organizations } = services;
  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    // Administrators' data must never be cached by browsers or intermediaries.
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });
    const audit = (
      request: {
        log: { info: (o: object, m: string) => void };
        admin?: { uid: string } | undefined;
      },
      action: string,
      entityId: string,
    ) => request.log.info({ audit: true, action, entityId, adminUid: request.admin?.uid }, 'audit');

    r.post(
      '/organizations',
      {
        schema: {
          operationId: 'createOrganization',
          summary: 'Create an organization',
          description:
            'The slug is generated from the name when omitted. A taken slug yields 409 with `details[0].suggestion`; the server never appends a suffix silently.',
          security: SECURITY,
          body: CreateOrganizationBodyDto,
          response: {
            201: jsonResponse('The created organization', OrganizationDto),
            ...errorResponses(400, 401, 403, 409),
          },
        },
      },
      async (request, reply) => {
        const created = await organizations.create(request.body);
        audit(request, 'organization.create', created.id);
        return reply.status(201).send(toOrganizationDto(created));
      },
    );

    r.get(
      '/organizations',
      {
        schema: {
          operationId: 'listOrganizations',
          summary: 'List organizations (by name, cursor pagination)',
          security: SECURITY,
          querystring: PageQueryDto,
          response: {
            200: jsonResponse('A page of organizations', OrganizationPageDto),
            ...errorResponses(400, 401, 403),
          },
        },
      },
      async (request) => {
        const { limit, cursor } = request.query;
        const page = await organizations.list({
          ...(limit !== undefined && { limit }),
          ...(cursor !== undefined && { cursor: cursor as Cursor }),
        });
        return { items: page.items.map(toOrganizationDto), nextCursor: page.nextCursor };
      },
    );

    r.get(
      '/organizations/:id',
      {
        schema: {
          operationId: 'getOrganization',
          summary: 'Get an organization',
          security: SECURITY,
          params: IdParamsDto,
          response: {
            200: jsonResponse('The organization', OrganizationDto),
            ...errorResponses(401, 403, 404),
          },
        },
      },
      async (request) => toOrganizationDto(await organizations.get(request.params.id)),
    );

    r.patch(
      '/organizations/:id',
      {
        schema: {
          operationId: 'renameOrganization',
          summary: 'Rename an organization',
          description:
            'Only `name` can change. The slug is immutable (a `slug` property is rejected with 400) and existing certificates keep their snapshot.',
          security: SECURITY,
          params: IdParamsDto,
          body: RenameOrganizationBodyDto,
          response: {
            200: jsonResponse('The renamed organization', OrganizationDto),
            ...errorResponses(400, 401, 403, 404),
          },
        },
      },
      async (request) => {
        const updated = await organizations.rename(request.params.id, request.body.name);
        audit(request, 'organization.rename', updated.id);
        return toOrganizationDto(updated);
      },
    );

    r.delete(
      '/organizations/:id',
      {
        schema: {
          operationId: 'deleteOrganization',
          summary: 'Delete an unreferenced organization',
          description:
            'Hard delete. Fails with 409 `IN_USE` and per-kind `counts` while events, templates or certificates reference it.',
          security: SECURITY,
          params: IdParamsDto,
          response: {
            204: { description: 'Deleted', content: { 'application/json': { schema: z.null() } } },
            ...errorResponses(401, 403, 404, 409),
          },
        },
      },
      async (request, reply) => {
        await organizations.delete(request.params.id);
        audit(request, 'organization.delete', request.params.id);
        return reply.status(204).send();
      },
    );
  });
}
