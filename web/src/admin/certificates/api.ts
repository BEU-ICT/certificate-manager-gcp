import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, STALE_TIME, type ApiError } from '@/api';
import type { components, operations } from '@/api/schema';

export type CertificateSummary = components['schemas']['AdminCertificateSummary'];
export type CertificatePage = components['schemas']['AdminCertificatePage'];
export type CertificateCount = components['schemas']['CertificateCount'];
type ListQuery = NonNullable<operations['listCertificates']['parameters']['query']>;

type Picked = Pick<
  ListQuery,
  'organizationId' | 'eventId' | 'type' | 'status' | 'emailStatus' | 'issuedFrom' | 'issuedTo'
>;
export type CertificateFilters = { [K in keyof Picked]?: Picked[K] | undefined };

export const CERTIFICATES_KEY = ['admin', 'certificates'] as const;
const BASE = '/admin/certificates';

function filterKey(filters: CertificateFilters) {
  return {
    organizationId: filters.organizationId ?? null,
    eventId: filters.eventId ?? null,
    type: filters.type ?? null,
    status: filters.status ?? null,
    emailStatus: filters.emailStatus ?? null,
    issuedFrom: filters.issuedFrom ?? null,
    issuedTo: filters.issuedTo ?? null,
  };
}

/** One page of certificates, newest first; cached for 30 s so Previous/Next reuse loaded pages. */
export function useCertificateList(
  filters: CertificateFilters,
  limit: number,
  cursor: string | undefined,
  enabled = true,
) {
  return useQuery<CertificatePage, ApiError>({
    queryKey: [
      ...CERTIFICATES_KEY,
      'list',
      { ...filterKey(filters), limit, cursor: cursor ?? null },
    ],
    queryFn: ({ signal }) =>
      api().get<CertificatePage>(BASE, { query: { ...filters, limit, cursor }, signal }),
    staleTime: STALE_TIME.list,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Total for the filters, independent of the list: the key has no page or cursor, so it is fetched
 * once per filter change, and a failure leaves the list untouched.
 */
export function useCertificateCount(filters: CertificateFilters, enabled = true) {
  return useQuery<CertificateCount, ApiError>({
    queryKey: [...CERTIFICATES_KEY, 'count', filterKey(filters)],
    queryFn: ({ signal }) =>
      api().get<CertificateCount>(`${BASE}/count`, { query: { ...filters }, signal }),
    staleTime: STALE_TIME.list,
    enabled,
  });
}

export type CertificateDetail = components['schemas']['AdminCertificate'];

const detailKey = (id: string) => [...CERTIFICATES_KEY, 'detail', id] as const;
const fetchCertificate = (id: string, signal?: AbortSignal) =>
  api().get<CertificateDetail>(`${BASE}/${encodeURIComponent(id)}`, { signal });

/** One certificate with every field (including the e-mail address); 404 for malformed and unknown IDs. */
export function useCertificate(id: string, enabled = true) {
  return useQuery<CertificateDetail, ApiError>({
    queryKey: detailKey(id),
    queryFn: ({ signal }) => fetchCertificate(id, signal),
    staleTime: STALE_TIME.detail,
    enabled,
  });
}

export type RevokedCertificate = components['schemas']['RevokedCertificate'];

/** Revokes a certificate (idempotent; repeating the call retries the PDF cleanup). */
export function useRevokeCertificate(id: string) {
  const queryClient = useQueryClient();
  return useMutation<RevokedCertificate, ApiError, { reason: string }>({
    mutationFn: ({ reason }) =>
      api().post<RevokedCertificate>(`${BASE}/${encodeURIComponent(id)}/revoke`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CERTIFICATES_KEY }),
  });
}

export type ResendEmailResult = components['schemas']['ResendEmailResult'];

/** Queues a new send of the certificate e-mail; `email` (optional) replaces the stored address. */
export function useResendEmail(id: string) {
  const queryClient = useQueryClient();
  return useMutation<ResendEmailResult, ApiError, { email?: string }>({
    mutationFn: ({ email }) =>
      api().post<ResendEmailResult>(
        `${BASE}/${encodeURIComponent(id)}/resend-email`,
        email ? { email } : {},
      ),
    // Awaited, so `mutateAsync` resolves once the detail (now `pending`) was refetched.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CERTIFICATES_KEY }),
  });
}

/** Fetches the certificate fresh and stores it in the query cache (used to poll the e-mail status). */
export function refreshCertificate(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): Promise<CertificateDetail> {
  return queryClient.fetchQuery({
    queryKey: detailKey(id),
    queryFn: ({ signal }) => fetchCertificate(id, signal),
    staleTime: 0,
  });
}
