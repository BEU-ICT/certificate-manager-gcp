import { describe, expect, it } from 'vitest';
import { createTestAdmin, createTestUser, getTestAuth, PROJECT_ID } from './helpers/index.js';

function decodePayload(jwt: string): Record<string, unknown> {
  const [, payload] = jwt.split('.');
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

// Verification through the real TokenVerifier lives in firebase-token-verifier.integration.test.ts.
// These tests pin the structure of the emulator's tokens the helpers rely on.
describe('Auth emulator tokens', () => {
  it('createTestAdmin issues an ID token with the role=admin claim', async () => {
    const admin = await createTestAdmin();

    expect(admin.idToken.split('.')).toHaveLength(3);
    const claims = decodePayload(admin.idToken);
    expect(claims).toMatchObject({
      aud: PROJECT_ID,
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      sub: admin.uid,
      user_id: admin.uid,
      email: admin.email,
      role: 'admin',
    });

    const verified = await getTestAuth().verifyIdToken(admin.idToken);
    expect(verified.uid).toBe(admin.uid);
    expect(verified['role']).toBe('admin');
  });

  it('createTestUser issues an ID token without the role claim', async () => {
    const user = await createTestUser();

    const claims = decodePayload(user.idToken);
    expect(claims).toMatchObject({ aud: PROJECT_ID, sub: user.uid, email: user.email });
    expect(claims).not.toHaveProperty('role');

    const verified = await getTestAuth().verifyIdToken(user.idToken);
    expect(verified['role']).toBeUndefined();
  });

  it('rejects a malformed token', async () => {
    await expect(getTestAuth().verifyIdToken('not-a-jwt')).rejects.toThrow();
  });
});
