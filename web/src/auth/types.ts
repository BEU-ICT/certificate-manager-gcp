/** Provider-neutral shapes of the auth module. Nothing here depends on the Firebase SDK. */

export interface AuthUser {
  uid: string;
  email: string | null;
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
}

export type Unsubscribe = () => void;

/**
 * Small set of failures the UI distinguishes. `invalidCredentials` deliberately covers wrong
 * password, unknown user and malformed email so no message reveals whether an account exists.
 */
export const AUTH_ERROR_KINDS = [
  'invalidCredentials',
  'tooManyRequests',
  'network',
  'disabled',
  'unknown',
] as const;
export type AuthErrorKind = (typeof AUTH_ERROR_KINDS)[number];

/** Thrown by every operation of the auth module. `message` never contains credentials. */
export class AuthError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind, options?: { cause?: unknown }) {
    super(`Authentication failed: ${kind}`, options);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}
