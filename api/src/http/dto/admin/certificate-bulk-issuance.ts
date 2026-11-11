import { z } from 'zod';
import {
  BULK_MAX_ITEMS,
  certificateTypeSchema,
  subjectSchema,
} from '../../../modules/certificates/index.js';
import { isEventId, isOrganizationId, isTemplateRef } from '../../../shared/ids.js';

const entityId = (guard: (v: unknown) => boolean) =>
  z.string().max(128).refine(guard, { message: 'Invalid identifier' });

/**
 * Body of `POST /api/v1/admin/certificates/bulk`. Only the envelope is validated here (strict,
 * 1 to 500 items, more or none is `400 VALIDATION_FAILED`). The items are validated one by one by
 * the issuance service (strict per-item schema, same rules as single issuance) so that every
 * problem is reported at once as `422 BULK_INVALID` with `items[i].field` paths.
 */
export function bulkIssueBodyDto() {
  return z.strictObject({
    organizationId: entityId(isOrganizationId),
    eventId: entityId(isEventId),
    templateId: z
      .string()
      .max(120)
      .refine(isTemplateRef, { message: 'Invalid template reference' })
      .optional()
      .describe(
        'Template reference (`<name>-v<n>`). Omit to use the latest version for the organization, event and type.',
      ),
    type: certificateTypeSchema,
    subject: subjectSchema
      .optional()
      .describe(
        'Default subject; an item `subject` overrides it. Every item needs one of the two.',
      ),
    items: z
      .array(z.unknown())
      .min(1)
      .max(BULK_MAX_ITEMS)
      .describe(
        'Items `{ ownerName, email?, subject?, skills?, issuedAt? }` (strict; same rules as single issuance), validated individually; see 422 BULK_INVALID.',
      ),
  });
}

/** What an idempotent bulk issuance stores and replays: ordered certificate IDs only (no personal data). */
export interface BulkIssuedMarker {
  certificateIds: string[];
}

export const BulkIssuedItemDto = z.object({
  id: z.string(),
  ownerName: z.string(),
  hasEmail: z
    .boolean()
    .describe('Whether an e-mail address is stored; the address is never returned.'),
});

export const BulkIssuedDto = z.object({
  created: z.number().int().describe('Number of certificates created.'),
  items: z.array(BulkIssuedItemDto).describe('In request order.'),
});
