import type { Auth, User } from 'firebase/auth';
import { toAuthError } from './errors';
import { loadAuth } from './firebase';
import { AuthError, type AuthUser, type Unsubscribe } from './types';

function toUser(user: User): AuthUser {
  return { uid: user.uid, email: user.email };
}

async function auth(): Promise<Auth> {
  try {
    return await loadAuth();
  } catch (cause) {
    throw new AuthError('unknown', { cause });
  }
}

/** Signs in with email and password. Rejects with an `AuthError`; never logs the credentials. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  const instance = await auth();
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  try {
    const credential = await signInWithEmailAndPassword(instance, email, password);
    return toUser(credential.user);
  } catch (error) {
    throw toAuthError(error);
  }
}

export async function signOut(): Promise<void> {
  const instance = await auth();
  try {
    await instance.signOut();
  } catch (error) {
    throw toAuthError(error);
  }
}

/**
 * Sends Firebase's reset email. An unknown or malformed address resolves like a known one, so the
 * result never reveals whether an account exists; network and rate-limit failures still reject.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const instance = await auth();
  const { sendPasswordResetEmail } = await import('firebase/auth');
  try {
    await sendPasswordResetEmail(instance, email);
  } catch (error) {
    const failure = toAuthError(error);
    if (failure.kind !== 'invalidCredentials') throw failure;
  }
}

/**
 * Subscribes to sign-in state changes (also fired for sign-outs in other tabs). The callback runs
 * once with the restored session. The returned function is safe to call before the SDK loaded.
 */
export function onAuthStateChanged(
  callback: (user: AuthUser | null) => void,
  onError?: (error: AuthError) => void,
): Unsubscribe {
  let cancelled = false;
  let stop: (() => void) | undefined;
  void (async () => {
    try {
      const instance = await auth();
      const { onAuthStateChanged: subscribe } = await import('firebase/auth');
      if (cancelled) return;
      stop = subscribe(instance, (user) => callback(user ? toUser(user) : null));
    } catch (error) {
      if (!cancelled) onError?.(toAuthError(error));
    }
  })();
  return () => {
    cancelled = true;
    stop?.();
  };
}

/**
 * The current ID token, or null when signed out. Waits for the persisted session to be restored
 * first. `forceRefresh` bypasses the SDK's cached token.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const instance = await auth();
  try {
    await instance.authStateReady();
    const user = instance.currentUser;
    return user ? await user.getIdToken(forceRefresh) : null;
  } catch (error) {
    throw toAuthError(error);
  }
}
