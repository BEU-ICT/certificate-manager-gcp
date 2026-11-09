import { z } from 'zod';
import { normalizeText } from '../../../modules/certificates/index.js';
import type { Certificate } from '../../../shared/domain.js';

export const REVOKE_REASON_MAX = 500;
const RAW_REASON_MAX = 4_000;

const codePoints = (value: string): number => Array.from(value).length;

/** Any length reaches the service, which answers 404 for malformed IDs like for unknown ones. */
export const CertificateIdParamsDto = z.strictObject({ id: z.string().max(512) });

export const RevokeCertificateBodyDto = z
  .strictObject({
    reason: z
      .string()
      .max(RAW_REASON_MAX)
      .transform(normalizeText)
      .refine((v) => codePoints(v) >= 1 && codePoints(v) <= REVOKE_REASON_MAX, {
        message: `Must be 1 to ${String(REVOKE_REASON_MAX)} characters`,
      })
      .describe('Plain text, 1 to 500 characters; escaped on output.'),
  })
  .meta({ id: 'RevokeCertificateBody' });

/** Administrator view of a revoked certificate (never contains the storage path). */
export const RevokedCertificateDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    organizationName: z.string(),
    eventId: z.string(),
    eventName: z.string(),
    templateId: z.string(),
    type: z.string(),
    ownerName: z.string(),
    email: z.string().nullable(),
    subject: z.string(),
    skills: z.array(z.string()),
    status: z.enum(['active', 'revoked']),
    issuedAt: z.iso.datetime({ offset: false }),
    revokedAt: z.iso.datetime({ offset: false }).nullable(),
    revokeReason: z.string().nullable(),
    emailStatus: z.string(),
    hasPdf: z.boolean().describe('False once the PDF reference was cleared.'),
    createdAt: z.iso.datetime({ offset: false }),
    updatedAt: z.iso.datetime({ offset: false }),
    warnings: z
      .array(z.literal('PDF_DELETE_FAILED'))
      .optional()
      .describe(
        'Present when the revocation succeeded but the PDF object could not be deleted; repeat the call to retry the deletion.',
      ),
  })
  .meta({ id: 'RevokedCertificate' });

export function toRevokedCertificateDto(
  c: Certificate,
  warnings: readonly string[],
): z.infer<typeof RevokedCertificateDto> {
  return {
    id: c.id,
    organizationId: c.organizationId,
    organizationName: c.organizationName,
    eventId: c.eventId,
    eventName: c.eventName,
    templateId: c.templateId,
    type: c.type,
    ownerName: c.ownerName,
    email: c.email ?? null,
    subject: c.subject,
    skills: c.skills,
    status: c.status,
    issuedAt: c.issuedAt.toISOString(),
    revokedAt: c.revokedAt?.toISOString() ?? null,
    revokeReason: c.revokeReason ?? null,
    emailStatus: c.emailStatus,
    hasPdf: c.pdfPath !== undefined,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    ...(warnings.length > 0 && { warnings: ['PDF_DELETE_FAILED' as const] }),
  };
}
