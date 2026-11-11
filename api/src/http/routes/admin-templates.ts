import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { checkTemplateUpload } from '../../modules/templates/index.js';
import type { Cursor } from '../../ports/common.js';
import {
  NotFoundError,
  UnavailableError,
  UnprocessableError,
  ValidationError,
} from '../../shared/errors.js';
import type { ErrorDetail } from '../../shared/errors.js';
import type { Services } from '../../wiring.js';
import { audit } from '../audit.js';
import { adminRoutes } from '../auth/admin-guard.js';
import {
  ReferenceParamsDto,
  TemplateCopyBodyDto,
  TemplateCopyResultDto,
  TemplateDetailDto,
  TemplateListQueryDto,
  TemplatePageDto,
  TemplateUploadBodyDto,
  TemplateUploadFieldsDto,
  TemplateUploadResultDto,
  toTemplateCopyResultDto,
  toTemplateDetailDto,
  toTemplateDto,
  toTemplateUploadResultDto,
} from '../dto/admin/template.js';
import {
  MULTIPART_LIMITS,
  UPLOAD_LIMITS,
  readTemplateUpload,
} from '../multipart/template-upload.js';
import { buildPreviewInput, TemplatePreviewBodyDto } from '../dto/admin/template-preview.js';
import { zodDetails } from '../error-handler.js';
import { errorResponses, jsonResponse } from '../openapi/responses.js';

const SECURITY = [{ bearerAuth: [] }];

/** Route timeout of the upload; Cloud Run's request timeout is 60 s. */
const UPLOAD_TIMEOUT_MS = 55_000;

export interface TemplateRouteOptions {
  /** `PUBLIC_BASE_URL`: the preview QR code encodes `<base>/c/PREVIEW000000000000000`. */
  publicBaseUrl: string;
  /** Source of "now" for the preview `issuedAt`; defaults to the system clock. */
  clock?: { now(): Date };
}

/** `/api/v1/admin/templates`: upload (multipart), copy, preview, list and get. */
export function adminTemplateRoutes(
  app: FastifyInstance,
  services: Services,
  options: TemplateRouteOptions = { publicBaseUrl: 'http://localhost:5173' },
): void {
  const { templates, organizations, events, pdf } = services;
  const now = (): Date => options.clock?.now() ?? new Date();

  adminRoutes(app, async (scope) => {
    // Scoped to the admin routes. `preservePath` keeps `fonts/x.ttf` as the file name.
    await scope.register(multipart, { limits: MULTIPART_LIMITS, preservePath: true });
    const r = scope.withTypeProvider<ZodTypeProvider>();
    r.addHook('onSend', (_request, reply, payload, done) => {
      void reply.header('cache-control', 'no-store');
      done(null, payload);
    });

    r.post(
      '/templates',
      {
        bodyLimit: UPLOAD_LIMITS.maxBodyBytes,
        handlerTimeout: UPLOAD_TIMEOUT_MS,
        // The multipart body is streamed by readTemplateUpload with hard limits; the schema below
        // documents it, so the generic body validation is switched off for this route.
        validatorCompiler: () => (data: unknown) => ({ value: data }),
        schema: {
          operationId: 'uploadTemplate',
          summary: 'Upload a template package (creates the next version)',
          description:
            'Creates the next version for the organization, event and type and generates the ' +
            'reference. Nothing is stored unless the whole package is valid. `422 TEMPLATE_INVALID` ' +
            'lists every finding in `error.details[]` as `{ code, path, file?, message }`; ' +
            '`422 EVENT_ORG_MISMATCH` means the event belongs to another organization. Existing ' +
            'versions are never overwritten.',
          security: SECURITY,
          consumes: ['multipart/form-data'],
          body: TemplateUploadBodyDto,
          response: {
            201: jsonResponse('The created template version', TemplateUploadResultDto),
            ...errorResponses(400, 401, 403, 404, 409, 413, 422),
          },
        },
      },
      async (request, reply) => {
        // After the handler timeout the 503 has been sent but this code keeps running: stop before
        // anything is stored so that a retry cannot create a second version.
        const assertNotTimedOut = (): void => {
          if (request.signal.aborted) throw new UnavailableError();
        };
        const form = await readTemplateUpload(request);
        assertNotTimedOut();

        const parsedFields = TemplateUploadFieldsDto.safeParse(Object.fromEntries(form.fields));
        const problems: ErrorDetail[] = parsedFields.success ? [] : zodDetails(parsedFields.error);
        if (form.config === undefined) {
          problems.push({ path: 'config', message: 'Required: send the template config' });
        }
        if (!parsedFields.success || form.config === undefined) {
          throw new ValidationError('Request validation failed', problems);
        }
        const { organizationId, eventId, type } = parsedFields.data;

        let configInput: unknown = form.config;
        if (typeof form.config === 'string') {
          try {
            configInput = JSON.parse(form.config);
          } catch {
            throw new ValidationError('Request validation failed', [
              { path: 'config', message: 'The config is not valid JSON' },
            ]);
          }
        }

        const organization = await organizations.get(organizationId).catch((error: unknown) => {
          if (error instanceof NotFoundError) {
            throw new NotFoundError('Organization not found', [
              { path: 'organizationId', message: 'Unknown organization' },
            ]);
          }
          throw error;
        });
        const event = await events.get(eventId).catch((error: unknown) => {
          if (error instanceof NotFoundError) {
            throw new NotFoundError('Event not found', [
              { path: 'eventId', message: 'Unknown event' },
            ]);
          }
          throw error;
        });
        if (event.organizationId !== organization.id) {
          throw new UnprocessableError(
            'EVENT_ORG_MISMATCH',
            'The event does not belong to the organization',
            [{ path: 'eventId', message: 'This event belongs to a different organization' }],
          );
        }

        const checked = checkTemplateUpload(configInput, form.files, form.intake);
        assertNotTimedOut();
        const template = await templates.publish({
          organizationId: organization.id,
          eventId: event.id,
          organizationSlug: organization.slug,
          eventSlug: event.slug,
          type,
          config: checked.config,
          files: [...form.files].map(([path, body]) => ({ path, body })),
          createdBy: request.admin?.uid ?? 'unknown',
        });
        audit(request, 'template.created', template.reference);
        const files = [
          { path: 'config.json', size: Buffer.byteLength(JSON.stringify(template.config)) },
          ...[...form.files].map(([path, body]) => ({ path, size: body.length })),
        ];
        return reply.status(201).send(toTemplateUploadResultDto(template, files, checked.warnings));
      },
    );

    r.post(
      '/templates/:reference/copy',
      {
        schema: {
          operationId: 'copyTemplate',
          summary: 'Copy a template version to an organization, event and type',
          description:
            'Creates the next version for the target organization, event and type (`type` ' +
            "defaults to the source's) with the same files and config; objects are copied " +
            'server side. Copying to the same organization, event and type creates the next ' +
            'version. The source and its certificates are untouched. `422 EVENT_ORG_MISMATCH` ' +
            'means the event belongs to another organization.',
          security: SECURITY,
          params: ReferenceParamsDto,
          body: TemplateCopyBodyDto,
          response: {
            201: jsonResponse('The created template version', TemplateCopyResultDto),
            ...errorResponses(400, 401, 403, 404, 409, 422),
          },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const source = await templates.get(request.params.reference);
        const organization = await organizations
          .get(body.organizationId)
          .catch((error: unknown) => {
            if (error instanceof NotFoundError) {
              throw new NotFoundError('Organization not found', [
                { path: 'organizationId', message: 'Unknown organization' },
              ]);
            }
            throw error;
          });
        const event = await events.get(body.eventId).catch((error: unknown) => {
          if (error instanceof NotFoundError) {
            throw new NotFoundError('Event not found', [
              { path: 'eventId', message: 'Unknown event' },
            ]);
          }
          throw error;
        });
        if (event.organizationId !== organization.id) {
          throw new UnprocessableError(
            'EVENT_ORG_MISMATCH',
            'The event does not belong to the organization',
            [{ path: 'eventId', message: 'This event belongs to a different organization' }],
          );
        }
        const copied = await templates.copy({
          sourceReference: source.reference,
          target: {
            organizationId: organization.id,
            eventId: event.id,
            organizationSlug: organization.slug,
            eventSlug: event.slug,
            type: body.type ?? source.type,
          },
          createdBy: request.admin?.uid ?? 'unknown',
        });
        audit(request, 'template.copied', copied.template.reference);
        return reply.status(201).send(toTemplateCopyResultDto(copied));
      },
    );

    r.post(
      '/templates/:reference/preview',
      {
        schema: {
          operationId: 'previewTemplate',
          summary: 'Render a sample PDF with a template (nothing is stored)',
          description:
            'Runs the production pipeline (load assets, fit check, render) with sample data: ' +
            'preset `typical` or `longest` (maximum field lengths), overridden by the provided ' +
            'fields. The QR code encodes `<PUBLIC_BASE_URL>/c/PREVIEW000000000000000`, which never ' +
            'resolves. `422 TEXT_DOES_NOT_FIT` lists the misfitting fields in `error.details[]` ' +
            'as `{ path, message }`. Nothing is written to storage or the database.',
          security: SECURITY,
          params: ReferenceParamsDto,
          body: TemplatePreviewBodyDto.nullish(),
          response: {
            200: {
              description:
                'The sample PDF (`Content-Disposition: inline`, `Cache-Control: no-store`)',
              content: {
                'application/pdf': {
                  schema: z.custom<Buffer>().meta({ type: 'string', format: 'binary' }),
                },
              },
            },
            ...errorResponses(400, 401, 403, 404, 422),
          },
        },
      },
      async (request, reply) => {
        const template = await templates.get(request.params.reference);
        const sample = buildPreviewInput(
          request.body ?? {},
          template.type,
          now(),
          options.publicBaseUrl,
        );
        const pdfBytes = await pdf.preview(template.reference, sample);
        audit(request, 'template.previewed', template.reference);
        return reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `inline; filename="preview-${template.reference}.pdf"`)
          .header('cache-control', 'no-store')
          .send(pdfBytes);
      },
    );

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
