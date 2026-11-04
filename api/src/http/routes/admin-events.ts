import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Cursor } from '../../ports/common.js';
import type { CertificateEvent } from '../../shared/domain.js';
import type { Services } from '../../wiring.js';
import { audit } from '../audit.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  CreateEventBodyDto,
  EventDto,
  EventListQueryDto,
  EventPageDto,
  toEventDto,
  UpdateEventBodyDto,
} from '../dto/admin/event.js';
import { IdParamsDto } from '../dto/admin/organization.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** `/api/v1/admin/events`: create, list (optionally per organization), get, update, delete. */
export function adminEventRoutes(app: FastifyInstance, services: Services): void {
  const { events, organizations } = services;

  /** Organization names for a set of events: one batched read, no N+1. */
  const withNames = async (items: readonly CertificateEvent[]) => {
    const names = await organizations.getNames([...new Set(items.map((e) => e.organizationId))]);
    return items.map((e) => toEventDto(e, names.get(e.organizationId) ?? ''));
  };

  adminRoutes(app, (scope) => {
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    r.post(
      '/events',
      {
        schema: {
          operationId: 'createEvent',
          summary: 'Create an event',
          description:
            'The slug is generated from the name when omitted and is unique within the organization. A taken slug yields 409 with `details[0].suggestion`. An unknown organization yields 404 with `details[0].path = organizationId`.',
          security: SECURITY,
          body: CreateEventBodyDto,
          response: {
            201: jsonResponse('The created event', EventDto),
            ...errorResponses(400, 401, 403, 404, 409),
          },
        },
      },
      async (request, reply) => {
        const created = await events.create(request.body);
        audit(request, 'event.create', created.id);
        const [dto] = await withNames([created]);
        return reply.status(201).send(dto);
      },
    );

    r.get(
      '/events',
      {
        schema: {
          operationId: 'listEvents',
          summary: 'List events (newest first, cursor pagination)',
          security: SECURITY,
          querystring: EventListQueryDto,
          response: {
            200: jsonResponse('A page of events', EventPageDto),
            ...errorResponses(400, 401, 403),
          },
        },
      },
      async (request) => {
        const { organizationId, limit, cursor } = request.query;
        const page = await events.list(
          { organizationId },
          {
            ...(limit !== undefined && { limit }),
            ...(cursor !== undefined && { cursor: cursor as Cursor }),
          },
        );
        return { items: await withNames(page.items), nextCursor: page.nextCursor };
      },
    );

    r.get(
      '/events/:id',
      {
        schema: {
          operationId: 'getEvent',
          summary: 'Get an event',
          security: SECURITY,
          params: IdParamsDto,
          response: {
            200: jsonResponse('The event', EventDto),
            ...errorResponses(401, 403, 404),
          },
        },
      },
      async (request) => {
        const [dto] = await withNames([await events.get(request.params.id)]);
        return dto;
      },
    );

    r.patch(
      '/events/:id',
      {
        schema: {
          operationId: 'updateEvent',
          summary: 'Update the name and/or e-mail language of an event',
          description:
            'At least one of `name`, `emailLanguage`. The slug and the organization are immutable (rejected with 400).',
          security: SECURITY,
          params: IdParamsDto,
          body: UpdateEventBodyDto,
          response: {
            200: jsonResponse('The updated event', EventDto),
            ...errorResponses(400, 401, 403, 404),
          },
        },
      },
      async (request) => {
        const updated = await events.update(request.params.id, request.body);
        audit(request, 'event.update', updated.id);
        const [dto] = await withNames([updated]);
        return dto;
      },
    );

    r.delete(
      '/events/:id',
      {
        schema: {
          operationId: 'deleteEvent',
          summary: 'Delete an unreferenced event',
          description:
            'Hard delete. Fails with 409 `IN_USE` and per-kind `counts` while templates or certificates reference it.',
          security: SECURITY,
          params: IdParamsDto,
          response: {
            204: { description: 'Deleted', content: { 'application/json': { schema: z.null() } } },
            ...errorResponses(401, 403, 404, 409),
          },
        },
      },
      async (request, reply) => {
        await events.delete(request.params.id);
        audit(request, 'event.delete', request.params.id);
        return reply.status(204).send();
      },
    );
  });
}
