import { createApiClient, type ApiClient, type ApiClientDeps } from './client';
import { clearApiCache } from './query';

export * from './client';
export * from './errors';
export * from './query';
export { ApiProvider } from './ApiProvider';

let current: ApiClient = createApiClient();

/** The shared client. Re-exported through a getter so `configureApi` takes effect everywhere. */
export function api(): ApiClient {
  return current;
}

/**
 * Wired once by the auth module (#73): provides `getToken` and the sign-out callback. A second
 * 401 clears the query cache before invoking `onUnauthorized`.
 */
export function configureApi(deps: ApiClientDeps): void {
  current = createApiClient({
    ...deps,
    onUnauthorized: () => {
      clearApiCache();
      deps.onUnauthorized?.();
    },
  });
}
