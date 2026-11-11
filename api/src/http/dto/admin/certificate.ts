import { z } from 'zod';
import type { CertificateFilter } from '../../../ports/index.js';
import { CERTIFICATE_TYPES } from '../../../shared/certificate-types.js';
import type { Certificate } from '../../../shared/domain.js';
import { emailSchema } from '../../../modules/certificates/index.js';
import { asEventId, asOrganizationId, isEventId, isOrganizationId } from '../../../shared/ids.js';
import { pageOf } from './page.js';

const Timestamp = z.iso.datetime({ offset: false });
const CertificateStatusDto = z.enum(['active', 'revoked']);
const EmailStatusDto = z.enum(['pending', 'sent', 'failed', 'skipped']);

/** List row: no e-mail address (limits exposure in lists), only `hasEmail`. */
export const AdminCertificateSummaryDto = z
  .object({
    id: z.string(),
    ownerName: z.string(),
    organizationName: z.string().describe('Snapshot taken at issue time.'),
    eventName: z.string().describe('Snapshot taken at issue time.'),
    type: z.enum(CERTIFICATE_TYPES),
    subject: z.string(),
    issuedAt: Timestamp,
    status: CertificateStatusDto,
    emailStatus: EmailStatusDto,
    hasEmail: z.boolean(),
  })
  .meta({ id: 'AdminCertificateSummary' });

export const AdminCertificatePageDto = pageOf(AdminCertificateSummaryDto, 'AdminCertificatePage');

export const AdminCertificateDto = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    eventId: z.string(),
    organizationName: z.string().describe('Snapshot taken at issue time.'),
    eventName: z.string().describe('Snapshot taken at issue time.'),
    templateId: z.string().describe('Reference (`<name>-v<n>`) of the template used.'),
    type: z.enum(CERTIFICATE_TYPES),
    ownerName: z.string(),
    email: z.string().nullable().describe('Only in the detail view; null when none was given.'),
    subject: z.string(),
    skills: z.array(z.string()),
    status: CertificateStatusDto,
    issuedAt: Timestamp,
    revokedAt: Timestamp.nullable(),
    revokeReason: z.string().nullable(),
    emailStatus: EmailStatusDto,
    emailAttempts: z.number().int(),
    emailSentAt: Timestamp.nullable(),
    emailLastError: z.string().nullable(),
    publicUrl: z.string().describe('Public verification page of the certificate.'),
    pdfUrl: z.string().nullable().describe('Public PDF URL; null while no PDF is stored.'),
    pdfGeneratedAt: Timestamp.nullable(),
    legacy: z
      .object({
        id: z.string(),
        certificateType: z.string().optional(),
        template: z.string().optional(),
      })
      .nullable()
      .describe('Set for certificates imported from the legacy system.'),
    createdBy: z.string().describe('Admin user ID that issued the certificate.'),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'AdminCertificate' });

export const CertificateCountDto = z.object({ count: z.number().int() }).meta({
  id: 'CertificateCount',
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_YEARS = 5;

function parseDate(value: string, endOfDay: boolean): Date | null {
  if (DATE_ONLY.test(value)) {
    const day = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) return null;
    // A date-only upper bound includes that whole day; the repository bound is exclusive.
    if (endOfDay) day.setUTCDate(day.getUTCDate() + 1);
    return day;
  }
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

const dateParam = (name: string, endOfDay: boolean) =>
  z
    .string()
    .max(40)
    .refine((v) => parseDate(v, endOfDay) !== null, {
      message: `${name} must be an ISO date (YYYY-MM-DD) or date-time`,
    })
    .optional();

const entityId = (guard: (v: unknown) => boolean) =>
  z.string().max(128).refine(guard, { message: 'Invalid identifier' }).optional();

/** Detail route params: any id length is accepted so malformed ids reach the lookup and yield 404. */
export const CertificateIdParamsDto = z.strictObject({ id: z.string() });

/** Filters shared by the list and the count endpoint. */
const filterShape = {
  organizationId: entityId(isOrganizationId),
  eventId: entityId(isEventId),
  type: z.enum(CERTIFICATE_TYPES).optional(),
  status: CertificateStatusDto.optional(),
  emailStatus: EmailStatusDto.optional(),
  issuedFrom: dateParam('issuedFrom', false).describe(
    'Inclusive lower bound: `YYYY-MM-DD` (start of that UTC day) or an ISO date-time.',
  ),
  issuedTo: dateParam('issuedTo', true).describe(
    'Upper bound: `YYYY-MM-DD` includes that whole UTC day; an ISO date-time is exclusive. Must not precede `issuedFrom`; the range spans at most 5 years (a date-only value counts a whole day in that span).',
  ),
};

function checkRange(
  q: { issuedFrom?: string | undefined; issuedTo?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (q.issuedFrom === undefined || q.issuedTo === undefined) return;
  const from = parseDate(q.issuedFrom, false);
  const to = parseDate(q.issuedTo, true);
  if (!from || !to) return;
  // A date-only `issuedTo` covers its whole day, so its last instant is the one before `to`.
  const lastInstant = DATE_ONLY.test(q.issuedTo) ? to.getTime() - 1 : to.getTime();
  if (from.getTime() > lastInstant) {
    ctx.addIssue({ code: 'custom', path: ['issuedFrom'], message: 'Must not be after issuedTo' });
    return;
  }
  const limit = new Date(from);
  limit.setUTCFullYear(limit.getUTCFullYear() + MAX_SPAN_YEARS);
  if (to.getTime() > limit.getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['issuedTo'],
      message: `The range must not exceed ${String(MAX_SPAN_YEARS)} years`,
    });
  }
}

const CertificateFilterQueryDto = z.strictObject(filterShape);

export const CertificateCountQueryDto = CertificateFilterQueryDto.superRefine(checkRange);

export const CertificateListQueryDto = CertificateFilterQueryDto.extend({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(512).optional(),
}).superRefine(checkRange);

/** Validated filter query to the repository filter (IDs are branded here, after validation). */
export function toCertificateFilter(
  q: z.infer<typeof CertificateCountQueryDto>,
): CertificateFilter {
  const filter: CertificateFilter = {};
  if (q.organizationId !== undefined) filter.organizationId = asOrganizationId(q.organizationId);
  if (q.eventId !== undefined) filter.eventId = asEventId(q.eventId);
  if (q.type !== undefined) filter.type = q.type;
  if (q.status !== undefined) filter.status = q.status;
  if (q.emailStatus !== undefined) filter.emailStatus = q.emailStatus;
  if (q.issuedFrom !== undefined) {
    const from = parseDate(q.issuedFrom, false);
    if (from) filter.issuedFrom = from;
  }
  if (q.issuedTo !== undefined) {
    const to = parseDate(q.issuedTo, true);
    if (to) filter.issuedTo = to;
  }
  return filter;
}

export function toAdminCertificateSummaryDto(
  c: Certificate,
): z.infer<typeof AdminCertificateSummaryDto> {
  return {
    id: c.id,
    ownerName: c.ownerName,
    organizationName: c.organizationName,
    eventName: c.eventName,
    type: c.type,
    subject: c.subject,
    issuedAt: c.issuedAt.toISOString(),
    status: c.status,
    emailStatus: c.emailStatus,
    hasEmail: c.email !== undefined && c.email !== '',
  };
}

export interface CertificateUrls {
  /** `PUBLIC_BASE_URL`: the web app; the verification page is `<base>/c/<id>`. */
  publicBaseUrl: string;
  /** `PDF_PUBLIC_BASE_URL`: the PDF bucket; the object is `<base>/<pdfPath>`. */
  pdfPublicBaseUrl: string;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, '');
const iso = (d: Date | undefined): string | null => (d ? d.toISOString() : null);

export function toAdminCertificateDto(
  c: Certificate,
  urls: CertificateUrls,
): z.infer<typeof AdminCertificateDto> {
  return {
    id: c.id,
    organizationId: c.organizationId,
    eventId: c.eventId,
    organizationName: c.organizationName,
    eventName: c.eventName,
    templateId: c.templateId,
    type: c.type,
    ownerName: c.ownerName,
    email: c.email ?? null,
    subject: c.subject,
    skills: c.skills,
    status: c.status,
    issuedAt: c.issuedAt.toISOString(),
    revokedAt: iso(c.revokedAt),
    revokeReason: c.revokeReason ?? null,
    emailStatus: c.emailStatus,
    emailAttempts: c.emailAttempts,
    emailSentAt: iso(c.emailSentAt),
    emailLastError: c.emailLastError ?? null,
    publicUrl: `${trimSlash(urls.publicBaseUrl)}/c/${encodeURIComponent(c.id)}`,
    pdfUrl: c.pdfPath
      ? `${trimSlash(urls.pdfPublicBaseUrl)}/${c.pdfPath.split('/').map(encodeURIComponent).join('/')}`
      : null,
    pdfGeneratedAt: iso(c.pdfGeneratedAt),
    legacy: c.legacy ?? null,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Body of `POST /api/v1/admin/certificates/:id/resend-email`. Strict; the optional corrected
 * address is validated and lowercased like at issuance (`emailSchema`: trimmed, max 254).
 */
export const ResendEmailBodyDto = z
  .strictObject({
    email: emailSchema
      .optional()
      .describe(
        'Corrected address; replaces the stored one. Omit to resend to the stored address.',
      ),
  })
  .meta({ id: 'ResendEmailBody' });

export const ResendEmailResultDto = z
  .object({
    emailStatus: z.literal('pending'),
    emailAttempts: z.number().int().describe('Sequence of the queued send (names the task).'),
  })
  .meta({ id: 'ResendEmailResult' });
