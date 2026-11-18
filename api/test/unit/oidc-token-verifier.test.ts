import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { OidcAdminUserDirectory } from '../../src/adapters/oidc/admin-user-directory.js';
import { OidcTokenVerifier } from '../../src/adapters/oidc/token-verifier.js';
import { describeTokenVerifierContract } from '../../src/testing/contracts/index.js';
import { loadConfig } from '../../src/config.js';
import { bootstrapAdmin } from '../../src/migrations/001-bootstrap-admin.js';
import { MigrationDeferred } from '../../src/migrations/index.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import {
  TEST_MIGRATION_SETTINGS,
  createMigrationContext,
} from '../../src/testing/migration-context.js';
import { UnauthenticatedError } from '../../src/shared/errors.js';

const ISSUER = 'https://idp.example.test/realms/certs';
const AUDIENCE = 'certificate-manager';

async function setup() {
  const rsa = await generateKeyPair('RS256');
  const ec = await generateKeyPair('ES256');
  const rsaJwk: JWK = {
    ...(await exportJWK(rsa.publicKey)),
    kid: 'rsa-1',
    alg: 'RS256',
    use: 'sig',
  };
  const ecJwk: JWK = { ...(await exportJWK(ec.publicKey)), kid: 'ec-1', alg: 'ES256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [rsaJwk, ecJwk] });
  const warnings: Record<string, unknown>[] = [];
  const verifier = new OidcTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    roleClaim: 'realm_access.roles',
    adminRole: 'admin',
    keys,
    logger: { warn: (o) => warnings.push(o) },
  });
  const sign = (
    claims: Record<string, unknown>,
    opts: {
      alg?: 'RS256' | 'ES256';
      kid?: string;
      aud?: string;
      iss?: string;
      exp?: number | string;
      key?: CryptoKey;
    } = {},
  ) => {
    const alg = opts.alg ?? 'RS256';
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg, kid: opts.kid ?? (alg === 'RS256' ? 'rsa-1' : 'ec-1') })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m');
    return jwt.sign(opts.key ?? (alg === 'RS256' ? rsa.privateKey : ec.privateKey));
  };
  return { verifier, sign, warnings, rsa };
}

const adminClaims = { sub: 'u-1', email: 'a@example.test', realm_access: { roles: ['admin'] } };

describeTokenVerifierContract('OidcTokenVerifier (local JWKS)', async () => {
  const { verifier, sign } = await setup();
  return {
    adapter: verifier,
    issueAdmin: async () => ({
      token: await sign(adminClaims),
      uid: 'u-1',
      email: 'a@example.test',
    }),
    issueWithoutRole: async () => ({
      token: await sign({ sub: 'u-2', email: 'b@example.test' }),
      uid: 'u-2',
    }),
    cleanup: () => undefined,
  };
});

describe('OidcTokenVerifier', () => {
  it('accepts ES256 and a string role claim path', async () => {
    const { verifier, sign } = await setup();
    const identity = await verifier.verify(await sign(adminClaims, { alg: 'ES256' }));
    expect(identity).toEqual({ uid: 'u-1', email: 'a@example.test', role: 'admin' });
  });

  it('gives no role when the admin role is absent', async () => {
    const { verifier, sign } = await setup();
    const t = await sign({ sub: 'u', realm_access: { roles: ['viewer'] } });
    expect((await verifier.verify(t)).role).toBeUndefined();
  });

  it('rejects expired, wrong audience, wrong issuer and unknown kid with the generic error', async () => {
    const { verifier, sign, warnings } = await setup();
    const bad = [
      await sign(adminClaims, { exp: Math.floor(Date.now() / 1000) - 3600 }),
      await sign(adminClaims, { aud: 'other' }),
      await sign(adminClaims, { iss: 'https://evil.example.test' }),
      await sign(adminClaims, { kid: 'unknown' }),
    ];
    for (const token of bad) {
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthenticatedError);
    }
    expect(warnings).toHaveLength(bad.length);
    expect(JSON.stringify(warnings)).not.toContain(bad[0]);
  });

  it('rejects a token signed with a key that is not in the JWKS', async () => {
    const { verifier, sign } = await setup();
    const other = await generateKeyPair('RS256');
    await expect(
      verifier.verify(await sign(adminClaims, { key: other.privateKey })),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects alg=none', async () => {
    const { verifier } = await setup();
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${enc({ alg: 'none', kid: 'rsa-1' })}.${enc({
      ...adminClaims,
      iss: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 300,
    })}.`;
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects an HS256 token (algorithm confusion)', async () => {
    const { verifier } = await setup();
    const token = await new SignJWT(adminClaims)
      .setProtectedHeader({ alg: 'HS256', kid: 'rsa-1' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a token without sub', async () => {
    const { verifier, sign } = await setup();
    await expect(verifier.verify(await sign({ email: 'x@example.test' }))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe('OidcAdminUserDirectory', () => {
  it('is read-only', async () => {
    const dir = new OidcAdminUserDirectory();
    await expect(dir.findByEmail()).resolves.toBeUndefined();
    await expect(dir.create()).rejects.toThrow();
    await expect(dir.setAdminRole()).rejects.toThrow();
  });
});

describe('OIDC configuration and bootstrap', () => {
  const base = { NODE_ENV: 'test', AUTH_PROVIDER: 'oidc' };

  it('requires OIDC_ISSUER and OIDC_AUDIENCE', () => {
    expect(() => loadConfig(base)).toThrow(/OIDC_ISSUER/);
  });

  it('applies role-claim defaults', () => {
    const config = loadConfig({ ...base, OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE });
    expect(config.oidc).toMatchObject({ roleClaim: 'realm_access.roles', adminRole: 'admin' });
  });

  it('skips the bootstrap migration (deferred, no account created)', async () => {
    const fakes = createFakes();
    const ctx = createMigrationContext(fakes, {
      settings: { ...TEST_MIGRATION_SETTINGS, authProvider: 'oidc' },
    });
    await expect(bootstrapAdmin.run(ctx)).rejects.toBeInstanceOf(MigrationDeferred);
  });
});
