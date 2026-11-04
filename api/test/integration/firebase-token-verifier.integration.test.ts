import { describe, expect, it } from 'vitest';
import { FirebaseTokenVerifier } from '../../src/adapters/firebase/token-verifier.js';
import { describeTokenVerifierContract } from '../../src/testing/contracts/index.js';
import { UnauthenticatedError } from '../../src/shared/errors.js';
import { createTestAdmin, createTestUser, getTestAuth } from './helpers/index.js';

describeTokenVerifierContract('FirebaseTokenVerifier (Auth emulator)', () => ({
  adapter: new FirebaseTokenVerifier(getTestAuth()),
  issueAdmin: async () => {
    const a = await createTestAdmin();
    return { token: a.idToken, uid: a.uid, email: a.email };
  },
  issueWithoutRole: async () => {
    const u = await createTestUser();
    return { token: u.idToken, uid: u.uid };
  },
  cleanup: () => undefined,
}));

describe('FirebaseTokenVerifier', () => {
  it('rejects an expired token with the generic message and logs the reason without the token', async () => {
    const warnings: Record<string, unknown>[] = [];
    const verifier = new FirebaseTokenVerifier(getTestAuth(), {
      logger: { warn: (obj) => warnings.push(obj) },
    });
    const header = Buffer.from('{"alg":"RS256","typ":"JWT"}').toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: 1, iat: 0, sub: 'x' })).toString('base64url');
    const token = `${header}.${payload}.sig`;
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(JSON.stringify(warnings)).not.toContain(token);
    expect(warnings).toHaveLength(1);
  });

  it('with checkRevoked rejects the token of a disabled user', async () => {
    const admin = await createTestAdmin();
    const verifier = new FirebaseTokenVerifier(getTestAuth(), { checkRevoked: true });
    await expect(verifier.verify(admin.idToken)).resolves.toMatchObject({ uid: admin.uid });
    await getTestAuth().updateUser(admin.uid, { disabled: true });
    await expect(verifier.verify(admin.idToken)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  // The emulator issues unsigned tokens, so no public key is fetched and the <5 ms budget of the
  // spec cannot be proven here; this guards against a per-request network round trip (budget 20 ms
  // because the emulator run shares the CPU with parallel test files).
  it('verifies repeated calls without a per-request round trip', async () => {
    const admin = await createTestAdmin();
    const verifier = new FirebaseTokenVerifier(getTestAuth());
    await verifier.verify(admin.idToken);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await verifier.verify(admin.idToken);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    expect(times[2], `times ${times.join(',')}`).toBeLessThan(20);
  });
});
