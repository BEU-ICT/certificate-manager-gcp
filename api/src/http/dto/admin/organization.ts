import { z } from 'zod';
import type { Organization } from '../../../shared/domain.js';
import { pageOf } from './page.js';

export const OrganizationDto = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().describe('Unique, immutable, ASCII kebab-case.'),
    createdAt: z.iso.datetime({ offset: false }),
    updatedAt: z.iso.datetime({ offset: false }),
  })
  .meta({ id: 'Organization' });

export const OrganizationPageDto = pageOf(OrganizationDto, 'OrganizationPage');

/** Properties not listed here are rejected (strict schema), so `slug` can never be patched. */
export const CreateOrganizationBodyDto = z
  .strictObject({
    name: z.string().describe('1 to 120 characters; plain text, escaped on output.'),
    slug: z
      .string()
      .optional()
      .describe('Optional; generated from the name when omitted. Immutable.'),
  })
  .meta({ id: 'CreateOrganizationBody' });

export const RenameOrganizationBodyDto = z
  .strictObject({ name: z.string().describe('1 to 120 characters.') })
  .meta({ id: 'RenameOrganizationBody' });

export const IdParamsDto = z.strictObject({ id: z.string().max(128) });

export function toOrganizationDto(o: Organization): z.infer<typeof OrganizationDto> {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}
