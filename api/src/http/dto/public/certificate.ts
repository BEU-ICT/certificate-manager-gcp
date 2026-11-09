import { z } from 'zod';
import { CERTIFICATE_TYPES } from '../../../shared/certificate-types.js';
import type { Certificate } from '../../../shared/domain.js';

/** Public certificate view. Built from an explicit whitelist in {@link toPublicCertificateDto}. */
export const PublicCertificateDto = z
  .object({
    id: z.string(),
    ownerName: z.string(),
    organizationName: z.string(),
    eventName: z.string(),
    type: z.enum(CERTIFICATE_TYPES),
    subject: z.string(),
    skills: z.array(z.string()),
    issuedAt: z.iso.datetime({ offset: false }),
    status: z.enum(['active', 'revoked']),
    pdfUrl: z
      .string()
      .nullable()
      .describe(
        'Direct PDF URL when generated; the on-demand generation endpoint when not generated yet; null when revoked.',
      ),
  })
  .meta({ id: 'PublicCertificate' });

export const PublicCertificateParamsDto = z.object({ id: z.string() });

export interface PublicUrls {
  /** `PUBLIC_BASE_URL`: origin of the public API/site. */
  publicBaseUrl: string;
  /** `PDF_PUBLIC_BASE_URL`: origin serving the PDF bucket. */
  pdfPublicBaseUrl: string;
}

const trimSlashes = (url: string): string => url.replace(/\/+$/, '');

export function publicPdfUrl(certificate: Certificate, urls: PublicUrls): string | null {
  if (certificate.status === 'revoked') return null;
  if (certificate.pdfPath) {
    return `${trimSlashes(urls.pdfPublicBaseUrl)}/pdfs/${certificate.pdfPath}`;
  }
  return `${trimSlashes(urls.publicBaseUrl)}/api/v1/public/certificates/${certificate.id}/pdf`;
}

export function toPublicCertificateDto(
  certificate: Certificate,
  urls: PublicUrls,
): z.infer<typeof PublicCertificateDto> {
  return {
    id: certificate.id,
    ownerName: certificate.ownerName,
    organizationName: certificate.organizationName,
    eventName: certificate.eventName,
    type: certificate.type,
    subject: certificate.subject,
    skills: certificate.skills.slice(),
    issuedAt: certificate.issuedAt.toISOString(),
    status: certificate.status,
    pdfUrl: publicPdfUrl(certificate, urls),
  };
}
