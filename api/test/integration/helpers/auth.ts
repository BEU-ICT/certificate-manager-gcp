import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { AUTH_HOST, PROJECT_ID } from './emulator.js';

const APP_NAME = 'integration-tests-auth';
// The Auth emulator accepts any API key.
const FAKE_API_KEY = 'fake-api-key';
const TEST_PASSWORD = 'integration-test-password';

export interface TestAccount {
  uid: string;
  email: string;
  /** Firebase ID token issued by the Auth emulator (custom claims included). */
  idToken: string;
}

/** Admin SDK Auth client bound to the Auth emulator. */
export function getTestAuth(): Auth {
  const app =
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp({ projectId: PROJECT_ID }, APP_NAME);
  return getAuth(app);
}

async function createAccount(claims: Record<string, unknown> | undefined): Promise<TestAccount> {
  const auth = getTestAuth();
  const email = `it-${randomUUID()}@example.test`;
  const user = await auth.createUser({ email, password: TEST_PASSWORD, emailVerified: true });
  if (claims) await auth.setCustomUserClaims(user.uid, claims);
  // Sign in through the emulator's REST API so that the token carries the claims set above.
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FAKE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD, returnSecureToken: true }),
    },
  );
  if (!res.ok)
    throw new Error(`Auth emulator sign-in failed: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error('Auth emulator sign-in returned no idToken');
  return { uid: user.uid, email, idToken: body.idToken };
}

/** Creates a user with the `role=admin` custom claim and returns its ID token. */
export function createTestAdmin(): Promise<TestAccount> {
  return createAccount({ role: 'admin' });
}

/** Creates a user without any custom claim (authenticated, but not an administrator). */
export function createTestUser(): Promise<TestAccount> {
  return createAccount(undefined);
}
