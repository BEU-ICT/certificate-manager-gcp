/** Where `/login` sends the administrator after signing in, and why they were sent there. */

export const ADMIN_HOME = '/admin';
export const LOGIN_PATH = '/login';

/** Router location state of `/login`. Set by the route guard and by the session-expiry handler. */
export interface LoginState {
  /** The admin route that was requested before sign-in was required. */
  from?: string;
  /** Why the user is here, rendered as a notice above the form. */
  reason?: 'expired' | 'noAccess';
}

const MAX_LENGTH = 2048;
// Backslashes and control characters are normalised by browsers into other separators.
function hasForbiddenChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}
const ADMIN_PREFIX = /^\/admin(?:[/?#]|$)/;
const BASE = 'http://internal.invalid';

/**
 * Returns `candidate` (path, query and hash) when it is an internal `/admin` location, otherwise
 * null. Absolute URLs, protocol-relative `//host` paths, `javascript:` URLs and paths that
 * normalise out of `/admin` (for example `/admin/../x`) are rejected, so a crafted link cannot
 * turn the post-login redirect into an open redirect.
 */
export function safeAdminPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || candidate.length > MAX_LENGTH) return null;
  if (hasForbiddenChar(candidate) || !ADMIN_PREFIX.test(candidate)) return null;
  let url: URL;
  try {
    url = new URL(candidate, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || !ADMIN_PREFIX.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

/** The validated post-login target: router state first, then `?next=`, then `/admin`. */
export function loginTarget(state: unknown, search: string): string {
  const fromState =
    typeof state === 'object' && state !== null ? safeAdminPath((state as LoginState).from) : null;
  if (fromState) return fromState;
  return safeAdminPath(new URLSearchParams(search).get('next')) ?? ADMIN_HOME;
}

export function loginReason(state: unknown): LoginState['reason'] {
  if (typeof state !== 'object' || state === null) return undefined;
  const reason = (state as LoginState).reason;
  return reason === 'expired' || reason === 'noAccess' ? reason : undefined;
}
