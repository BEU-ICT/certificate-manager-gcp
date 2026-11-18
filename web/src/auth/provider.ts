import type { AuthError, AuthUser, Unsubscribe } from './types';

/** Which implementation of the auth module this build contains (`VITE_AUTH_PROVIDER`). */
export type AuthProviderName = 'firebase' | 'oidc';

/** Fixed at build time: the other provider's code and SDK are not part of the bundle. */
export const AUTH_PROVIDER: AuthProviderName =
  import.meta.env.VITE_AUTH_PROVIDER === 'oidc' ? 'oidc' : 'firebase';

/** What every provider implements; `index.ts` exposes it as the public functions. */
export interface AuthBackend {
  signIn(email: string, password: string, returnTo?: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  onAuthStateChanged(
    callback: (user: AuthUser | null) => void,
    onError?: (error: AuthError) => void,
  ): Unsubscribe;
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
  preload(): void;
  /** Finishes a redirect sign-in on the callback route; resolves with the stored return path. */
  completeSignIn(): Promise<string | null>;
}

let backend: Promise<AuthBackend> | undefined;

/**
 * The backend module is chosen at build time: `selected-backend.ts` is the Firebase one, and
 * `vite.config.ts` swaps it for `selected-backend.oidc.ts` when `VITE_AUTH_PROVIDER=oidc`, so the
 * other provider's code and SDK never enter the bundle.
 */
export function loadBackend(): Promise<AuthBackend> {
  backend ??= import('./selected-backend').then((m) => m.backend);
  return backend;
}
