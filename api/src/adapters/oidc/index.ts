import { createRemoteJWKSet } from 'jose';
import type { AdapterContext } from '../registry.js';
import { createLogger } from '../../http/logging/logger.js';
import type { AuthPorts } from '../../wiring.js';
import { GoogleTaskRequestVerifier } from '../google/task-request-verifier.js';
import { OidcAdminUserDirectory } from './admin-user-directory.js';
import { OidcTokenVerifier } from './token-verifier.js';

const FETCH_TIMEOUT_MS = 5000;

/** Resolves `jwks_uri` from the issuer's discovery document once; a failure is retried next call. */
export function discoveredJwksUri(issuer: string): () => Promise<URL> {
  let pending: Promise<URL> | undefined;
  return () => {
    pending ??= (async () => {
      const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${String(res.status)}`);
      const doc = (await res.json()) as { jwks_uri?: unknown };
      if (typeof doc.jwks_uri !== 'string') throw new Error('OIDC discovery has no jwks_uri');
      return new URL(doc.jwks_uri);
    })().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

/** `AUTH_PROVIDER=oidc`. Keys come from the issuer's JWKS (cached, rotation-aware, bounded timeouts). */
export function createAuthPorts({ config }: AdapterContext): AuthPorts {
  const oidc = config.oidc;
  if (!oidc) throw new Error('OIDC configuration is missing');
  const logger = createLogger({ level: config.logLevel, gcpProject: config.gcpProject });
  const jwksUri = oidc.jwksUri
    ? () => Promise.resolve(new URL(oidc.jwksUri as string))
    : discoveredJwksUri(oidc.issuer);
  let remote: ReturnType<typeof createRemoteJWKSet> | undefined;
  return {
    adminUsers: new OidcAdminUserDirectory(),
    tokenVerifier: new OidcTokenVerifier({
      issuer: oidc.issuer,
      audience: oidc.audience,
      roleClaim: oidc.roleClaim,
      adminRole: oidc.adminRole,
      keys: async (header, token) => {
        remote ??= createRemoteJWKSet(await jwksUri(), {
          timeoutDuration: FETCH_TIMEOUT_MS,
          cooldownDuration: 30_000,
          cacheMaxAge: 600_000,
        });
        return remote(header, token);
      },
      logger,
    }),
    taskRequestVerifier: new GoogleTaskRequestVerifier({
      audience: config.serviceUrl,
      invokerServiceAccount: config.tasks.invokerServiceAccount,
      onReject: (reason) => logger.warn({ reason }, 'task request authentication failed'),
    }),
  };
}
