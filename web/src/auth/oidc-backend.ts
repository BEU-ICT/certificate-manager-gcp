import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { AuthError, type AuthUser, type Unsubscribe } from './types';
import type { AuthBackend } from './provider';

/**
 * OpenID Connect (authorization code + PKCE, no implicit flow) through `oidc-client-ts`; the only
 * file that imports it. Configuration: `VITE_OIDC_AUTHORITY` (issuer URL), `VITE_OIDC_CLIENT_ID`,
 * optional `VITE_OIDC_SCOPE` (default `openid profile email`).
 *
 * Tokens live in `sessionStorage` (library default, set explicitly): they survive reloads of the
 * tab but are not shared with other tabs or kept after it closes, and nothing is written to
 * localStorage. Silent renew uses the refresh token when the IdP issues one (Keycloak does for
 * the code flow) and falls back to a hidden iframe otherwise. The API receives the ID token, like
 * with Firebase, so its audience is the client id.
 */
export const CALLBACK_PATH = '/auth/callback';

let manager: UserManager | undefined;

function getManager(): UserManager {
  if (manager) return manager;
  const authority = import.meta.env.VITE_OIDC_AUTHORITY;
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  if (!authority || !clientId) throw new AuthError('unknown');
  manager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${window.location.origin}/login`,
    silent_redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    response_type: 'code',
    scope: import.meta.env.VITE_OIDC_SCOPE || 'openid profile email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
  return manager;
}

function toUser(user: User): AuthUser {
  const email = user.profile.email;
  return { uid: user.profile.sub, email: typeof email === 'string' ? email : null };
}

function usable(user: User | null): User | null {
  return user && !user.expired && user.id_token ? user : null;
}

function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const message = error instanceof Error ? error.message : '';
  const kind = /network|fetch|failed to/i.test(message) ? 'network' : 'unknown';
  return new AuthError(kind, { cause: error });
}

export const oidcBackend: AuthBackend = {
  /** Redirects to the IdP (credentials are never typed here); the returned promise never settles. */
  async signIn(email: string, _password: string, returnTo?: string): Promise<AuthUser> {
    try {
      await getManager().signinRedirect({
        state: returnTo,
        ...(email ? { login_hint: email } : {}),
      });
    } catch (error) {
      throw toAuthError(error);
    }
    return new Promise<AuthUser>(() => undefined);
  },

  async signOut() {
    try {
      const m = getManager();
      // Ends the IdP session too (needs the stored ID token); the browser returns to /login.
      await m.signoutRedirect().catch(() => m.removeUser());
    } catch (error) {
      throw toAuthError(error);
    }
  },

  /** The IdP owns passwords, so there is nothing to send. */
  sendPasswordReset: () => Promise.resolve(),

  onAuthStateChanged(callback, onError): Unsubscribe {
    let m: UserManager;
    try {
      m = getManager();
    } catch (error) {
      onError?.(toAuthError(error));
      return () => undefined;
    }
    const loaded = (user: User) => callback(usable(user) ? toUser(user) : null);
    const unloaded = () => callback(null);
    m.events.addUserLoaded(loaded);
    m.events.addUserUnloaded(unloaded);
    m.events.addUserSignedOut(unloaded);
    m.events.addSilentRenewError(unloaded);
    void m
      .getUser()
      .then((user) => {
        const ok = usable(user);
        callback(ok ? toUser(ok) : null);
      })
      .catch((error: unknown) => onError?.(toAuthError(error)));
    return () => {
      m.events.removeUserLoaded(loaded);
      m.events.removeUserUnloaded(unloaded);
      m.events.removeUserSignedOut(unloaded);
      m.events.removeSilentRenewError(unloaded);
    };
  },

  async getIdToken(forceRefresh = false) {
    try {
      const m = getManager();
      let user = usable(await m.getUser());
      if (user && forceRefresh) user = usable(await m.signinSilent());
      return user?.id_token ?? null;
    } catch (error) {
      const failure = toAuthError(error);
      // A renew the IdP refuses means the session is gone, not that the network is down.
      if (failure.kind === 'network') throw failure;
      return null;
    }
  },

  preload: () => undefined,

  async completeSignIn() {
    try {
      const user = await getManager().signinRedirectCallback();
      return typeof user.state === 'string' ? user.state : null;
    } catch (error) {
      throw toAuthError(error);
    }
  },
};
