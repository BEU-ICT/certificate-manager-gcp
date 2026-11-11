import { useQuery } from '@tanstack/react-query';
import { api, type ApiError } from '@/api';
import type { components } from '@/api/schema';

export type PublicCertificate = components['schemas']['PublicCertificate'];

/** Public, unauthenticated; the API revalidates on every request, so nothing is considered fresh. */
export function usePublicCertificate(id: string) {
  return useQuery<PublicCertificate, ApiError>({
    queryKey: ['public', 'certificate', id],
    queryFn: ({ signal }) =>
      api().get<PublicCertificate>(`/public/certificates/${encodeURIComponent(id)}`, { signal }),
    staleTime: 0,
  });
}

const GENERATION_ENDPOINT = /\/public\/certificates\/[^/]+\/pdf$/;

/** True when the link is the on-demand generation endpoint (first download renders the PDF). */
export function isGenerationEndpoint(pdfUrl: string): boolean {
  try {
    return GENERATION_ENDPOINT.test(new URL(pdfUrl, globalThis.location.origin).pathname);
  } catch {
    return false;
  }
}

/** Only http(s) links are rendered as hrefs, whatever the API returns. */
export function isSafePdfUrl(pdfUrl: string): boolean {
  try {
    const { protocol } = new URL(pdfUrl, globalThis.location.origin);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
