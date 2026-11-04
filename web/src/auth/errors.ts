import { AuthError, type AuthErrorKind } from './types';

const KIND_BY_CODE: Record<string, AuthErrorKind> = {
  'auth/invalid-credential': 'invalidCredentials',
  'auth/invalid-login-credentials': 'invalidCredentials',
  'auth/wrong-password': 'invalidCredentials',
  'auth/user-not-found': 'invalidCredentials',
  'auth/invalid-email': 'invalidCredentials',
  'auth/missing-email': 'invalidCredentials',
  'auth/missing-password': 'invalidCredentials',
  'auth/too-many-requests': 'tooManyRequests',
  'auth/network-request-failed': 'network',
  'auth/timeout': 'network',
  'auth/user-disabled': 'disabled',
};

/** Maps a Firebase error code (`auth/...`) to an app error kind. */
export function authErrorKind(code: string | undefined): AuthErrorKind {
  return (code && KIND_BY_CODE[code]) || 'unknown';
}

function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Wraps anything thrown by the SDK. The original error is kept as `cause` for debugging only. */
export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  return new AuthError(authErrorKind(codeOf(error)), { cause: error });
}
