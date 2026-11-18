import { AuthError, type AuthUser, type Unsubscribe } from './types';
import { loadBackend } from './provider';

async function backend() {
  try {
    return await loadBackend();
  } catch (cause) {
    throw new AuthError('unknown', { cause });
  }
}

/** Starts loading the SDK without waiting for it (call from route code to warm the chunk). */
export function preloadAuth(): void {
  void backend().then(
    (b) => b.preload(),
    () => undefined,
  );
}

/**
 * Password sign-in (Firebase). With the OIDC provider the arguments are only a login hint: the
 * browser is redirected to the identity provider (and back to `returnTo`) and the promise never
 * settles.
 */
export async function signIn(
  email: string,
  password: string,
  returnTo?: string,
): Promise<AuthUser> {
  return (await backend()).signIn(email, password, returnTo);
}

export async function signOut(): Promise<void> {
  return (await backend()).signOut();
}

export async function sendPasswordReset(email: string): Promise<void> {
  return (await backend()).sendPasswordReset(email);
}

/** The current ID token, or null when signed out. `forceRefresh` renews it first. */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  return (await backend()).getIdToken(forceRefresh);
}

/** Finishes a redirect sign-in (OIDC callback route); resolves with the return path, if any. */
export async function completeSignIn(): Promise<string | null> {
  return (await backend()).completeSignIn();
}

/**
 * Subscribes to sign-in state changes. The callback runs once with the restored session. The
 * returned function is safe to call before the provider has loaded.
 */
export function onAuthStateChanged(
  callback: (user: AuthUser | null) => void,
  onError?: (error: AuthError) => void,
): Unsubscribe {
  let cancelled = false;
  let stop: Unsubscribe | undefined;
  void backend().then(
    (b) => {
      if (!cancelled) stop = b.onAuthStateChanged(callback, onError);
    },
    (error: unknown) => {
      if (!cancelled) onError?.(error instanceof AuthError ? error : new AuthError('unknown'));
    },
  );
  return () => {
    cancelled = true;
    stop?.();
  };
}
