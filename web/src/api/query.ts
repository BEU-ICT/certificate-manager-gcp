import { QueryClient } from '@tanstack/react-query';
import { ApiError, isApiError } from './errors';

/** `staleTime` per query type (ms). */
export const STALE_TIME = {
  /** Rarely changing reference data: certificate types, organizations list. */
  static: 5 * 60_000,
  /** Detail screens. */
  detail: 60_000,
  /** Paginated lists and dashboard counts. */
  list: 30_000,
  /** Always refetch: send status, job progress. */
  live: 0,
} as const;

const MAX_RETRIES = 2;

/** Network failures and 5xx are retried (twice); 4xx and everything else never. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  if (!isApiError(error)) return false;
  return error.isNetwork || error.status >= 500;
}

export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.list,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
      },
      // Mutations are never retried: only GET is idempotent.
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();

/** Drops every cached response; call on sign-out so no admin data outlives the session. */
export function clearApiCache(): void {
  queryClient.clear();
}

export type { ApiError };
