import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, isApiError, STALE_TIME, type ApiError } from '@/api';

// Typed by hand: `api/openapi.json` does not list the admin organization routes yet (the spec
// generator builds the app without services). Shapes follow `api/src/http/dto/admin/organization.ts`.
export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationPage {
  items: Organization[];
  nextCursor: string | null;
}

export const ORGANIZATIONS_KEY = ['admin', 'organizations'] as const;
const BASE = '/admin/organizations';

export function useOrganizationList(limit: number, cursor: string | undefined) {
  return useQuery<OrganizationPage, ApiError>({
    queryKey: [...ORGANIZATIONS_KEY, { limit, cursor: cursor ?? null }],
    queryFn: ({ signal }) =>
      api().get<OrganizationPage>(BASE, { query: { limit, cursor }, signal }),
    staleTime: STALE_TIME.list,
    placeholderData: keepPreviousData,
  });
}

function invalidate(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_KEY });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation<Organization, ApiError, { name: string; slug: string }>({
    mutationFn: (body) => api().post<Organization>(BASE, body),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useRenameOrganization() {
  const queryClient = useQueryClient();
  return useMutation<Organization, ApiError, { id: string; name: string }>({
    mutationFn: ({ id, name }) =>
      api().patch<Organization>(`${BASE}/${encodeURIComponent(id)}`, { name }),
    onSuccess: () => invalidate(queryClient),
  });
}

export function useDeleteOrganization() {
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

export interface InUseCounts {
  events: number;
  templates: number;
  certificates: number;
}

/** `409` with `details[0] = { path: 'references', message: 'IN_USE', counts }`. */
export function inUseCounts(error: unknown): InUseCounts | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const d = error.details?.find((x) => x.path === 'references' && x.message === 'IN_USE');
  if (!d) return null;
  return {
    events: d.counts?.['events'] ?? 0,
    templates: d.counts?.['templates'] ?? 0,
    certificates: d.counts?.['certificates'] ?? 0,
  };
}
