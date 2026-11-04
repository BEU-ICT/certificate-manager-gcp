import { describe, it } from 'vitest';
import type { AdminIdentity, TokenVerifier } from '../../ports/index.js';
import { UnauthenticatedError } from '../../shared/errors.js';
import { clause, type AdapterHandle } from './types.js';

const PORT = 'TokenVerifier';
const VERIFY_OK =
  'verify: A valid token resolves with the uid and email of the user and the role custom claim';
const VERIFY_NO_ROLE =
  'verify: A valid token of a user without a role claim resolves with role undefined';
const VERIFY_FAIL =
  'verify: Any invalid token rejects with UnauthenticatedError and the same message for every reason';

/** The handle issues tokens that the adapter under test accepts. */
export interface TokenVerifierHandle extends AdapterHandle<TokenVerifier> {
  issueAdmin: () => Promise<{ token: string; uid: string; email: string }>;
  issueWithoutRole: () => Promise<{ token: string; uid: string }>;
}

export type TokenVerifierContractFactory = () => Promise<TokenVerifierHandle> | TokenVerifierHandle;

/** Executable form of the TSDoc on `TokenVerifier` (src/ports/auth.ts). */
export function describeTokenVerifierContract(
  name: string,
  factory: TokenVerifierContractFactory,
): void {
  const test = (title: string, body: (handle: TokenVerifierHandle) => Promise<void>) =>
    it(title, async () => {
      const handle = await factory();
      try {
        await body(handle);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`TokenVerifier contract: ${name}`, () => {
    test('maps a valid admin token to an identity', async ({ adapter, issueAdmin }) => {
      const { token, uid, email } = await issueAdmin();
      const identity = await adapter.verify(token);
      clause(PORT, VERIFY_OK, 'uid').that(identity.uid).toBe(uid);
      clause(PORT, VERIFY_OK, 'email').that(identity.email).toBe(email);
      clause(PORT, VERIFY_OK, 'role').that(identity.role).toBe('admin');
    });

    test('returns role undefined for a user without the claim', async ({
      adapter,
      issueWithoutRole,
    }) => {
      const { token, uid } = await issueWithoutRole();
      const identity: AdminIdentity = await adapter.verify(token);
      clause(PORT, VERIFY_NO_ROLE, 'uid').that(identity.uid).toBe(uid);
      clause(PORT, VERIFY_NO_ROLE, 'role').that(identity.role).toBeUndefined();
    });

    test('rejects garbage identically', async ({ adapter }) => {
      const messages = new Set<string>();
      for (const bad of ['not-a-jwt', 'a.b.c', 'x'.repeat(5000)]) {
        await clause(PORT, VERIFY_FAIL, `rejects "${bad.slice(0, 10)}"`).rejectedWith(
          adapter.verify(bad),
          UnauthenticatedError,
        );
        try {
          await adapter.verify(bad);
        } catch (error) {
          messages.add((error as Error).message);
        }
      }
      clause(PORT, VERIFY_FAIL, 'message').that(messages.size).toBe(1);
    });
  });
}
