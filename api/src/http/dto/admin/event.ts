import { z } from 'zod';
import type { CertificateEvent } from '../../../shared/domain.js';
import { pageOf } from './page.js';

const EmailLanguageDto = z.enum(['az', 'en']);

export const EventDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    organizationName: z.string().describe('Current name of the organization.'),
    name: z.string(),
    slug: z.string().describe('Unique within the organization; immutable.'),
    emailLanguage: EmailLanguageDto,
    createdAt: z.iso.datetime({ offset: false }),
    updatedAt: z.iso.datetime({ offset: false }),
  })
  .meta({ id: 'Event' });

export const EventPageDto = pageOf(EventDto, 'EventPage');

export const CreateEventBodyDto = z
  .strictObject({
    organizationId: z.string().max(128),
    name: z.string().describe('1 to 120 characters; plain text, escaped on output.'),
    slug: z
      .string()
      .optional()
      .describe('Optional; generated from the name. For yearly events include the year.'),
    emailLanguage: EmailLanguageDto.optional().describe('Language of the e-mails; default `az`.'),
  })
  .meta({ id: 'CreateEventBody' });

/** At least one property is required (checked by the service); `slug`/`organizationId` are rejected. */
export const UpdateEventBodyDto = z
  .strictObject({
    name: z.string().optional(),
    emailLanguage: EmailLanguageDto.optional(),
  })
  .meta({ id: 'UpdateEventBody' });

export const EventListQueryDto = z.strictObject({
  organizationId: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export function toEventDto(
  event: CertificateEvent,
  organizationName: string,
): z.infer<typeof EventDto> {
  return {
    id: event.id,
    organizationId: event.organizationId,
    organizationName,
    name: event.name,
    slug: event.slug,
    emailLanguage: event.emailLanguage,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}
