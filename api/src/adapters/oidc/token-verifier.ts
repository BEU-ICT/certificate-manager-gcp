import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AdminIdentity, TokenVerifier } from '../../ports/index.js';
import { UnauthenticatedError } from '../../shared/errors.js';

/** Minimal logger surface (pino-compatible); the reason of a rejection is logged, never the token. */
export interface WarnLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface OidcTokenVerifierOptions {
  issuer: string;
  audience: string;
  /** Dot path of the claim holding the roles, e.g. `realm_access.roles`. */
  roleClaim: string;
  /** Role value that maps to `role: 'admin'`. */
  adminRole: string;
  /** Resolves the signing key of a token (remote JWKS in production, a local set in tests). */
  keys: JWTVerifyGetKey;
  /** Allow-list; `none` and the HMAC family are never accepted. Default RS256, ES256. */
  algorithms?: readonly string[];
  clockToleranceSeconds?: number;
  logger?: WarnLogger;
}

const MAX_TOKEN_LENGTH = 8192;
const GENERIC_MESSAGE = 'Invalid or expired token';
const DEFAULT_ALGORITHMS = ['RS256', 'ES256'];

function claimAt(payload: JWTPayload, path: string): unknown {
  let current: unknown = payload;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Verifies RS256/ES256 JWTs of a standard OIDC issuer. Signature, `iss`, `aud`, `exp` and `nbf`
 * are checked by jose against a fixed algorithm allow-list, so `alg=none` and RS/HS key
 * confusion cannot succeed. Every failure is the same generic {@link UnauthenticatedError}.
 */
export class OidcTokenVerifier implements TokenVerifier {
  private readonly algorithms: string[];

  constructor(private readonly options: OidcTokenVerifierOptions) {
    this.algorithms = [...(options.algorithms ?? DEFAULT_ALGORITHMS)];
  }

  async verify(bearer: string): Promise<AdminIdentity> {
    const { logger } = this.options;
    if (bearer.length === 0 || bearer.length > MAX_TOKEN_LENGTH) {
      logger?.warn({ reason: 'token-length' }, 'token verification failed');
      throw new UnauthenticatedError(GENERIC_MESSAGE);
    }
    try {
      const { payload } = await jwtVerify(bearer, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: this.algorithms,
        clockTolerance: this.options.clockToleranceSeconds ?? 30,
        requiredClaims: ['sub', 'exp'],
      });
      const sub = payload.sub;
      if (typeof sub !== 'string' || sub === '') throw new Error('missing sub');
      const roles = claimAt(payload, this.options.roleClaim);
      const isAdmin = Array.isArray(roles)
        ? roles.includes(this.options.adminRole)
        : roles === this.options.adminRole;
      const email = payload['email'];
      return {
        uid: sub,
        email: typeof email === 'string' ? email : '',
        role: isAdmin ? 'admin' : undefined,
      };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      logger?.warn(
        { reason: typeof code === 'string' ? code : 'unknown' },
        'token verification failed',
      );
      throw new UnauthenticatedError(GENERIC_MESSAGE);
    }
  }
}
