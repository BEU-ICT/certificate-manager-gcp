import { z } from 'zod';
import { CERTIFICATE_TYPES } from '../../../shared/certificate-types.js';
import type { TemplateDetail, TemplateListItem } from '../../../modules/templates/index.js';
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
