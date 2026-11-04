import type { Auth } from 'firebase-admin/auth';
import type { AdminIdentity, TokenVerifier } from '../../ports/index.js';
import { UnauthenticatedError } from '../../shared/errors.js';

/** Minimal logger surface (pino-compatible); the reason of a rejection is logged, never the token. */
export interface WarnLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface FirebaseTokenVerifierOptions {
  /** Also rejects tokens of disabled or revoked users (one extra Auth API call per request). */
  checkRevoked?: boolean;
  logger?: WarnLogger;
}

const MAX_TOKEN_LENGTH = 4096;
const GENERIC_MESSAGE = 'Invalid or expired token';

/**
 * Verifies Firebase ID tokens with the Admin SDK. Issuer and audience are checked against the
 * project the `Auth` instance was created for (GCP_PROJECT); the SDK caches Google's public keys.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly checkRevoked: boolean;
  private readonly logger: WarnLogger | undefined;

  constructor(
    private readonly auth: Auth,
    options: FirebaseTokenVerifierOptions = {},
  ) {
    this.checkRevoked = options.checkRevoked ?? false;
    this.logger = options.logger;
  }

  async verify(bearer: string): Promise<AdminIdentity> {
    if (bearer.length === 0 || bearer.length > MAX_TOKEN_LENGTH) {
      this.logger?.warn({ reason: 'token-length' }, 'token verification failed');
      throw new UnauthenticatedError(GENERIC_MESSAGE);
    }
    try {
      const decoded = await this.auth.verifyIdToken(bearer, this.checkRevoked);
      const role: unknown = decoded['role'];
      return {
        uid: decoded.uid,
        email: decoded.email ?? '',
        role: typeof role === 'string' ? role : undefined,
      };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.logger?.warn(
        { reason: typeof code === 'string' ? code : 'unknown' },
        'token verification failed',
      );
      throw new UnauthenticatedError(GENERIC_MESSAGE);
    }
  }
}
