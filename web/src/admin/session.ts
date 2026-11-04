import { ApiError, configureApi, NETWORK } from '@/api';
import { getIdToken, isAuthError } from '@/auth';

let configured = false;
let onExpired: (() => void) | undefined;

/** Registers what happens when the API client gives up on a session (a second 401). */
export function setSessionExpiredHandler(handler: (() => void) | undefined): void {
  onExpired = handler;
}

/**
 * Wires the API client to the auth module (once): admin calls get the current ID token and a
 * forced refresh after a 401. A failed refresh that is not a network problem yields no token, so
 * the request ends in a 401 and the client's `onUnauthorized` hook runs the registered handler.
 * Call before the first admin request.
 */
export function ensureApiAuth(): void {
  if (configured) return;
  configured = true;
  configureApi({
    getToken: async (forceRefresh) => {
      try {
        return await getIdToken(forceRefresh);
      } catch (error) {
        if (isAuthError(error) && error.kind === 'network') {
          throw new ApiError({ status: 0, code: NETWORK, message: 'Network request failed.' });
        }
        return null;
      }
    },
    onUnauthorized: () => onExpired?.(),
  });
}
