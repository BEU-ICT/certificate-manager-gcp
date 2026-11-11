import { OAuth2Client } from 'google-auth-library';
import type { TaskCaller, TaskRequestVerifier } from '../../ports/index.js';
import { UnauthenticatedError } from '../../shared/errors.js';

const GOOGLE_ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com'];
const MAX_TOKEN_LENGTH = 4096;

/** The part of `OAuth2Client` that is used; lets tests inject a mock. */
export interface IdTokenClient {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{
    getPayload(): { iss?: string; email?: string; email_verified?: boolean } | undefined;
  }>;
}

export interface GoogleTaskRequestVerifierOptions {
  /** `SERVICE_URL`: the audience the queue puts into the token. */
  audience: string;
  /** `TASKS_INVOKER_SA`: the only service account accepted. Without it every call is denied. */
  invokerServiceAccount: string | undefined;
  client?: IdTokenClient;
  /** Receives a short reason code (never the token). */
  onReject?: (reason: string) => void;
}

/**
 * Verifies the Google OIDC token that Cloud Tasks attaches (BEU-ICT/certificate-manager#368):
 * `Authorization: Bearer <JWT>`, signed by Google, issuer Google, audience `SERVICE_URL`,
 * `email_verified` and `email == TASKS_INVOKER_SA`. Every failure is the same
 * `UnauthenticatedError`; the reason only goes to `onReject` (logged as a code).
 */
export class GoogleTaskRequestVerifier implements TaskRequestVerifier {
  private readonly client: IdTokenClient;

  constructor(private readonly options: GoogleTaskRequestVerifierOptions) {
    this.client = options.client ?? new OAuth2Client();
  }

  async verify(authorizationHeader: string | undefined): Promise<TaskCaller> {
    const reject = (reason: string): never => {
      this.options.onReject?.(reason);
      throw new UnauthenticatedError();
    };
    const expected = this.options.invokerServiceAccount?.toLowerCase();
    if (!expected) return reject('not-configured');
    const token =
      typeof authorizationHeader === 'string'
        ? /^Bearer ([^\s,]+)$/.exec(authorizationHeader)?.[1]
        : undefined;
    if (token === undefined || token.length > MAX_TOKEN_LENGTH) return reject('malformed');

    let payload: ReturnType<Awaited<ReturnType<IdTokenClient['verifyIdToken']>>['getPayload']>;
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: token,
        audience: this.options.audience,
      });
      payload = ticket.getPayload();
    } catch {
      return reject('invalid-token');
    }
    if (!payload) return reject('no-payload');
    if (payload.iss === undefined || !GOOGLE_ISSUERS.includes(payload.iss)) {
      return reject('issuer');
    }
    if (payload.email_verified !== true) return reject('email-not-verified');
    if (payload.email?.toLowerCase() !== expected) return reject('wrong-service-account');
    return { identity: expected };
  }
}
