export interface AdminIdentity {
  uid: string;
  email: string;
  role: string;
}

/** Verifies an administrator bearer token. */
export interface TokenVerifier {
  /** Accepts the raw token (without `Bearer `). Throws `UnauthenticatedError` when invalid or expired. */
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
