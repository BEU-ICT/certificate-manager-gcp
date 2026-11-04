/** Identity carried by a verified ID token. `role` is the `role` custom claim; absent when the user has none. */
export interface AdminIdentity {
  uid: string;
  email: string;
  role?: string | undefined;
}

/** Verifies a bearer token and maps it to the caller's identity. Authorisation (`role`) is the caller's job. */
export interface TokenVerifier {
  /**
   * Accepts the raw token (without `Bearer `). Every failure (expired, bad signature, wrong
   * audience or issuer, malformed, revoked when revocation checks are on) throws
   * `UnauthenticatedError` with the same generic message; the reason is logged, never returned.
   * A valid token whose user has no `role` claim resolves with `role` undefined.
   */
  verify(bearer: string): Promise<AdminIdentity>;
}

export interface TaskCaller {
  /** Identity of the calling service account. */
  identity: string;
}

/** Verifies calls from the task queue / scheduler to `/internal/**`. */
export interface TaskRequestVerifier {
  /** Throws `UnauthenticatedError` when the credential is missing or does not match. */
  verify(authorizationHeader: string | undefined): Promise<TaskCaller>;
}
