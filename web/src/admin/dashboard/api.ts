import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, STALE_TIME, type ApiError } from '@/api';
import type { components } from '@/api/schema';

export type AdminStats = components['schemas']['AdminStats'];

export const STATS_KEY = ['admin', 'stats'] as const;
const PATH = '/admin/stats';

/** Dashboard counts: one request on load, no polling and no refetch on window focus. */
export function useAdminStats() {
  return useQuery<AdminStats, ApiError>({
    queryKey: STATS_KEY,
    queryFn: ({ signal }) => api().get<AdminStats>(PATH, { signal }),
    staleTime: STALE_TIME.list,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

/** `?refresh=true` bypasses the server cache (429 when used more than once per 10 s). */
export function useRefreshAdminStats() {
  const queryClient = useQueryClient();
  return useMutation<AdminStats, ApiError, void>({
    mutationFn: () => api().get<AdminStats>(PATH, { query: { refresh: 'true' } }),
    onSuccess: (data) => queryClient.setQueryData(STATS_KEY, data),
  });
}
