import { z } from 'zod';
import { certificateContentShape } from '../../../modules/certificates/index.js';
import { isEventId, isOrganizationId, isTemplateRef } from '../../../shared/ids.js';

const entityId = (guard: (v: unknown) => boolean) =>
  z.string().max(128).refine(guard, { message: 'Invalid identifier' });

/**
 * Body of `POST /api/v1/admin/certificates`. Strict: unknown properties are rejected. Content
 * fields share their rules with bulk issuance (`certificateContentShape`); `issuedAt` is bounded
 * by `now()` (at most 5 minutes in the future) and defaults to the time of the request.
 */
export function issueCertificateBodyDto(now: () => Date) {
  const content = certificateContentShape(now);
  // No `.meta({ id })`: the factory runs per app instance and a repeated id would be renamed in the OpenAPI components.
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
    type: content.type,
    ownerName: content.ownerName,
    email: content.email,
    subject: content.subject,
    skills: content.skills.optional(),
    issuedAt: content.issuedAt.optional(),
  });
}

/** What an idempotent issuance stores and replays: the identifier only (no personal data). */
export interface IssuedMarker {
  certificateId: string;
}
