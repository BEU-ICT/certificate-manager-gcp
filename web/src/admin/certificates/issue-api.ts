import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, STALE_TIME, type ApiError } from '@/api';
import type { operations } from '@/api/schema';
import { TEMPLATES_KEY, type TemplatePage } from '../templates/api';
import { CERTIFICATES_KEY, type CertificateDetail } from './api';

export type IssueCertificateBody =
  operations['issueCertificate']['requestBody']['content']['application/json'];

/** The API accepts at most 50 per page; the newest versions come first, which is all the form needs. */
const TEMPLATE_OPTIONS_PAGE = 50;

export interface TemplateOptionFilters {
  organizationId: string;
  eventId: string;
  type: string;
}

/**
 * Template versions of one organization, event and type, newest first. Uses the same query key as
 * `useTemplateList` (first page of 50), so the cache is shared with the templates screen. Disabled
 * until all three are chosen.
 */
export function useTemplateOptions({ organizationId, eventId, type }: TemplateOptionFilters) {
  return useQuery<TemplatePage, ApiError>({
    queryKey: [
      ...TEMPLATES_KEY,
      'list',
      { organizationId, eventId, type, limit: TEMPLATE_OPTIONS_PAGE, cursor: null },
    ],
    queryFn: ({ signal }) =>
      api().get<TemplatePage>('/admin/templates', {
        query: { organizationId, eventId, type, limit: TEMPLATE_OPTIONS_PAGE },
        signal,
      }),
    staleTime: STALE_TIME.list,
    enabled: organizationId !== '' && eventId !== '' && type !== '',
  });
}

export interface IssueVariables {
  body: IssueCertificateBody;
  /** One UUID per submit attempt; the same key is sent again when the attempt is retried. */
  idempotencyKey: string;
}

/** `POST /admin/certificates`; resolves with the issued certificate (`201`). */
export function useIssueCertificate() {
  const queryClient = useQueryClient();
  return useMutation<CertificateDetail, ApiError, IssueVariables>({
    mutationFn: ({ body, idempotencyKey }) =>
      api().post<CertificateDetail>('/admin/certificates', body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CERTIFICATES_KEY }),
  });
}
