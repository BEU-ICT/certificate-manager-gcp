import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, isApiError, STALE_TIME, type ApiError } from '@/api';
import type { components } from '@/api/schema';
import { EVENTS_KEY, ORGANIZATION_OPTIONS_PAGE, type EventPage } from '../events/api';

export type Template = components['schemas']['Template'];
export type TemplateDetail = components['schemas']['TemplateDetail'];
export type TemplatePage = components['schemas']['TemplatePage'];

// TODO(BEU-ICT/certificate-manager#314): `POST /admin/templates/{reference}/copy` is not in
// `schema.d.ts` yet. Switch to the generated types once `npm run api:types` includes it.
export interface CopyTemplateBody {
  organizationId: string;
  eventId: string;
  /** Defaults to the type of the source template. */
  type?: string;
}
export type CopyTemplateResult = Template & { copiedFrom: string };

export const TEMPLATES_KEY = ['admin', 'templates'] as const;
const BASE = '/admin/templates';

export interface TemplateFilters {
  organizationId?: string | undefined;
  eventId?: string | undefined;
  type?: string | undefined;
}

/** List of template versions, newest first; cached for 30 s (`STALE_TIME.list`). */
export function useTemplateList(
  filters: TemplateFilters,
  limit: number,
  cursor: string | undefined,
) {
  return useQuery<TemplatePage, ApiError>({
    queryKey: [
      ...TEMPLATES_KEY,
      'list',
      {
        organizationId: filters.organizationId ?? null,
        eventId: filters.eventId ?? null,
        type: filters.type ?? null,
        limit,
        cursor: cursor ?? null,
      },
    ],
    queryFn: ({ signal }) =>
      api().get<TemplatePage>(BASE, {
        query: { ...filters, limit, cursor },
        signal,
      }),
    staleTime: STALE_TIME.list,
    placeholderData: keepPreviousData,
  });
}

export function useTemplate(reference: string) {
  return useQuery<TemplateDetail, ApiError>({
    queryKey: [...TEMPLATES_KEY, 'detail', reference],
    queryFn: ({ signal }) =>
      api().get<TemplateDetail>(`${BASE}/${encodeURIComponent(reference)}`, { signal }),
    staleTime: STALE_TIME.detail,
  });
}

/** Events of one organization (50 per page, "load more"); disabled until an organization is set. */
export function useEventOptions(organizationId: string) {
  return useInfiniteQuery<EventPage, ApiError>({
    queryKey: [...EVENTS_KEY, 'options', organizationId],
    queryFn: ({ pageParam, signal }) =>
      api().get<EventPage>('/admin/events', {
        query: {
          organizationId,
          limit: ORGANIZATION_OPTIONS_PAGE,
          cursor: pageParam as string | undefined,
        },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: STALE_TIME.static,
    enabled: organizationId !== '',
  });
}

export function useCopyTemplate(reference: string) {
  const queryClient = useQueryClient();
  return useMutation<CopyTemplateResult, ApiError, CopyTemplateBody>({
    mutationFn: (body) =>
      api().post<CopyTemplateResult>(`${BASE}/${encodeURIComponent(reference)}/copy`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
}

/** Paths of the form fields a `422` points at (`organizationId`, `eventId`, `type`). */
export function copyFieldErrors(error: unknown): Set<string> {
  const paths = new Set<string>();
  if (!isApiError(error) || error.status !== 422) return paths;
  for (const d of error.details ?? []) paths.add(d.path);
  return paths;
}
