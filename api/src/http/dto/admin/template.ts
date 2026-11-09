import { z } from 'zod';
import { CERTIFICATE_TYPES } from '../../../shared/certificate-types.js';
import type { Issue, TemplateDetail, TemplateListItem } from '../../../modules/templates/index.js';
import type { Template } from '../../../shared/domain.js';
import { ENTITY_ID_PATTERN } from '../../../shared/ids.js';
import { pageOf } from './page.js';

export const TemplateDto = z
  .object({
    reference: z.string().describe('`<orgSlug>-<eventSlug>-<type>-v<n>`; never parse it.'),
    organizationId: z.string(),
    organizationSlug: z.string(),
    eventId: z.string(),
    eventSlug: z.string(),
    type: z.enum(CERTIFICATE_TYPES),
    version: z.number().int().min(0),
    createdAt: z.iso.datetime({ offset: false }),
    isLatest: z.boolean().describe('No newer version exists for the organization, event and type.'),
  })
  .meta({ id: 'Template' });

export const TemplateDetailDto = TemplateDto.extend({
  config: z.record(z.string(), z.unknown()).describe('The stored template config.'),
  files: z
    .array(z.object({ path: z.string(), size: z.number().int().min(0).describe('Bytes.') }))
    .describe('Package files in storage, relative to the template.'),
  certificateCount: z.number().int().min(0),
}).meta({ id: 'TemplateDetail' });

export const TemplateUploadFieldsDto = z.strictObject({
  organizationId: z.string().regex(ENTITY_ID_PATTERN, { error: 'Not a valid organization ID' }),
  eventId: z.string().regex(ENTITY_ID_PATTERN, { error: 'Not a valid event ID' }),
  type: z.enum(CERTIFICATE_TYPES),
});

/**
 * Documentation of the multipart request (the body is read as a stream by the route, so this
 * schema is not used for validation). File parts are named by their relative path.
 */
export const TemplateUploadBodyDto = z
  .object({
    organizationId: z.string().describe('ID of the organization that owns the event.'),
    eventId: z.string().describe('ID of the event; it must belong to the organization.'),
    type: z.enum(CERTIFICATE_TYPES),
    config: z
      .string()
      .meta({ format: 'binary' })
      .describe(
        'The template config JSON: a file part named `config` or a plain text field `config`.',
      ),
  })
  .catchall(z.string().meta({ format: 'binary' }))
  .meta({
    id: 'TemplateUploadBody',
    description:
      'multipart/form-data. Besides the fields above, every other part is a package file whose ' +
      '**filename is its relative path** (`background.svg`, `fonts/Inter-Regular.ttf`, ' +
      '`assets/logo.png`); the part name is free. Limits: 30 files, 10 MB of files, 5 MB per ' +
      'part (fonts 3 MB), 10.5 MB per request. The part content type is ignored.',
  });

export const TemplateIssueDto = z
  .object({
    code: z.string().describe('Stable code, e.g. SVG_SCRIPT, FILE_NOT_FOUND.'),
    path: z.string().describe('Config path or package file the finding belongs to.'),
    file: z.string().optional(),
    message: z.string(),
  })
  .meta({ id: 'TemplateIssue' });

export const TemplateUploadResultDto = TemplateDto.omit({
  organizationSlug: true,
  eventSlug: true,
  isLatest: true,
})
  .extend({
    config: z.record(z.string(), z.unknown()).describe('The stored template config.'),
    files: z
      .array(z.object({ path: z.string(), size: z.number().int().min(0).describe('Bytes.') }))
      .describe('Stored package files including `config.json`, sorted by path.'),
    warnings: z
      .array(TemplateIssueDto)
      .describe('Advisory findings; they did not block the upload.'),
  })
  .meta({ id: 'TemplateUploadResult' });

export const TemplatePageDto = pageOf(TemplateDto, 'TemplatePage');

export const TemplateListQueryDto = z.strictObject({
  organizationId: z.string().max(128).optional(),
  eventId: z.string().max(128).optional(),
  type: z.enum(CERTIFICATE_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

/** Malformed references are answered 404 by the service, so no pattern here. */
export const ReferenceParamsDto = z.strictObject({ reference: z.string() });

export function toTemplateDto({
  template,
  isLatest,
}: TemplateListItem): z.infer<typeof TemplateDto> {
  return {
    reference: template.reference,
    organizationId: template.organizationId,
    organizationSlug: template.organizationSlug,
    eventId: template.eventId,
    eventSlug: template.eventSlug,
    type: template.type,
    version: template.version,
    createdAt: template.createdAt.toISOString(),
    isLatest,
  };
}

export function toTemplateDetailDto(detail: TemplateDetail): z.infer<typeof TemplateDetailDto> {
  return {
    reference: detail.template.reference,
    organizationId: detail.template.organizationId,
    organizationSlug: detail.template.organizationSlug,
    eventId: detail.template.eventId,
    eventSlug: detail.template.eventSlug,
    type: detail.template.type,
    version: detail.template.version,
    createdAt: detail.template.createdAt.toISOString(),
    isLatest: detail.isLatest,
    config: detail.template.config,
    files: detail.files,
    certificateCount: detail.certificateCount,
  };
}

export function toTemplateUploadResultDto(
  template: Template,
  files: readonly { path: string; size: number }[],
  warnings: readonly Issue[],
): z.infer<typeof TemplateUploadResultDto> {
  return {
    reference: template.reference,
    version: template.version,
    organizationId: template.organizationId,
    eventId: template.eventId,
    type: template.type,
    config: template.config,
    files: files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    warnings: warnings.map((w) => ({
      code: w.code,
      path: w.path,
      ...(w.file !== undefined && { file: w.file }),
      message: w.message,
    })),
    createdAt: template.createdAt.toISOString(),
  };
}
