import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, isApiError, STALE_TIME, type ApiError } from '@/api';
import { ORGANIZATIONS_KEY, type OrganizationPage } from '../organizations/api';

// Typed by hand: `api/openapi.json` does not list the admin routes yet. Shapes follow
// `api/src/http/dto/admin/event.ts`.
export type EmailLanguage = 'az' | 'en';

export interface CertificateEvent {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  emailLanguage: EmailLanguage;
  createdAt: string;
  updatedAt: string;
}

export interface EventPage {
  items: CertificateEvent[];
  nextCursor: string | null;
}

export const EVENTS_KEY = ['admin', 'events'] as const;
const BASE = '/admin/events';
/** The API accepts at most 50 per page. */
export const ORGANIZATION_OPTIONS_PAGE = 50;

export function useEventList(
  organizationId: string | undefined,
  limit: number,
  cursor: string | undefined,
) {
  return useQuery<EventPage, ApiError>({
    queryKey: [
      ...EVENTS_KEY,
      { organizationId: organizationId ?? null, limit, cursor: cursor ?? null },
    ],
    queryFn: ({ signal }) =>
      api().get<EventPage>(BASE, { query: { organizationId, limit, cursor }, signal }),
    staleTime: STALE_TIME.list,
    placeholderData: keepPreviousData,
  });
}

/**
 * Organizations for the filter and the create dialog, loaded lazily page by page ("load more").
 * Lives under `ORGANIZATIONS_KEY`, so it is shared by both selects and refreshed whenever an
 * organization is created, renamed or deleted.
 */
export function useOrganizationOptions(enabled = true) {
  return useInfiniteQuery<OrganizationPage, ApiError>({
    queryKey: [...ORGANIZATIONS_KEY, 'options'],
    queryFn: ({ pageParam, signal }) =>
      api().get<OrganizationPage>('/admin/organizations', {
        query: { limit: ORGANIZATION_OPTIONS_PAGE, cursor: pageParam as string | undefined },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: STALE_TIME.static,
    enabled,
  });
}

function invalidate(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
}

export interface CreateEventBody {
  organizationId: string;
  name: string;
  slug: string;
  emailLanguage: EmailLanguage;
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation<CertificateEvent, ApiError, CreateEventBody>({
    mutationFn: (body) => api().post<CertificateEvent>(BASE, body),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation<
    CertificateEvent,
    ApiError,
    { id: string; name: string; emailLanguage: EmailLanguage }
  >({
    mutationFn: ({ id, ...body }) =>
      api().patch<CertificateEvent>(`${BASE}/${encodeURIComponent(id)}`, body),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => api().delete<void>(`${BASE}/${encodeURIComponent(id)}`),
    onSuccess: () => invalidate(queryClient),
  });
}

/** `409` with `details[0] = { path: 'slug', message: 'SLUG_TAKEN', suggestion }`. */
export function slugTaken(error: unknown): { suggestion: string | undefined } | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const d = error.details?.find((x) => x.path === 'slug' && x.message === 'SLUG_TAKEN');
  return d ? { suggestion: d.suggestion } : null;
}

/** `404` with `details[0].path = 'organizationId'`: the organization was deleted meanwhile. */
export function organizationMissing(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.status === 404 &&
    (error.details?.some((x) => x.path === 'organizationId') ?? false)
  );
}

export interface InUseCounts {
  templates: number;
  certificates: number;
}

/** `409` with `details[0] = { path: 'references', message: 'IN_USE', counts }`. */
export function inUseCounts(error: unknown): InUseCounts | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const d = error.details?.find((x) => x.path === 'references' && x.message === 'IN_USE');
  if (!d) return null;
  return {
    templates: d.counts?.['templates'] ?? 0,
    certificates: d.counts?.['certificates'] ?? 0,
  };
}
