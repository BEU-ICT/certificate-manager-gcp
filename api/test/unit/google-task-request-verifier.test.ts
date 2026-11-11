import { describe, expect, it, vi } from 'vitest';
import {
  GoogleTaskRequestVerifier,
  type IdTokenClient,
} from '../../src/adapters/google/task-request-verifier.js';
import { UnauthenticatedError } from '../../src/shared/errors.js';

const SA = 'tasks-invoker@proj.iam.gserviceaccount.com';
const AUD = 'https://api.example.run.app';

type Payload = { iss?: string; email?: string; email_verified?: boolean } | undefined;

function make(payload: Payload | Error, invokerServiceAccount: string | undefined | null = SA) {
  const verifyIdToken = vi.fn<IdTokenClient['verifyIdToken']>(() =>
    payload instanceof Error
      ? Promise.reject(payload)
      : Promise.resolve({ getPayload: () => payload }),
  );
  const reasons: string[] = [];
  const verifier = new GoogleTaskRequestVerifier({
    audience: AUD,
    invokerServiceAccount: invokerServiceAccount ?? undefined,
    client: { verifyIdToken },
    onReject: (r) => reasons.push(r),
  });
  return { verifier, verifyIdToken, reasons };
}

const good = { iss: 'https://accounts.google.com', email: SA, email_verified: true };

describe('GoogleTaskRequestVerifier', () => {
  it('accepts a valid token and verifies it against SERVICE_URL', async () => {
    const { verifier, verifyIdToken } = make(good);
    await expect(verifier.verify('Bearer abc.def.ghi')).resolves.toEqual({ identity: SA });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'abc.def.ghi', audience: AUD });
  });

  it('accepts the short Google issuer and an upper-case e-mail', async () => {
    const { verifier } = make({ ...good, iss: 'accounts.google.com', email: SA.toUpperCase() });
    await expect(verifier.verify('Bearer t')).resolves.toBeDefined();
  });

  it.each([
    ['missing header', undefined, good, 'malformed'],
    ['other scheme', 'Basic abc', good, 'malformed'],
    ['two tokens', 'Bearer a b', good, 'malformed'],
    ['oversized', `Bearer ${'a'.repeat(5000)}`, good, 'malformed'],
    [
      'library rejects (signature, audience, expiry)',
      'Bearer t',
      new Error('wrong audience'),
      'invalid-token',
    ],
    ['no payload', 'Bearer t', undefined, 'no-payload'],
    ['foreign issuer', 'Bearer t', { ...good, iss: 'https://evil.example' }, 'issuer'],
    ['missing issuer', 'Bearer t', { email: SA, email_verified: true }, 'issuer'],
    ['unverified e-mail', 'Bearer t', { ...good, email_verified: false }, 'email-not-verified'],
    [
      'wrong service account',
      'Bearer t',
      { ...good, email: 'other@proj.iam.gserviceaccount.com' },
      'wrong-service-account',
    ],
    ['no e-mail', 'Bearer t', { iss: good.iss, email_verified: true }, 'wrong-service-account'],
  ] as const)('rejects: %s', async (_name, header, payload, reason) => {
    const { verifier, reasons } = make(payload);
    await expect(verifier.verify(header)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(reasons).toEqual([reason]);
  });

  it('denies everything when TASKS_INVOKER_SA is not configured', async () => {
    const { verifier, verifyIdToken, reasons } = make(good, null);
    await expect(verifier.verify('Bearer t')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(reasons).toEqual(['not-configured']);
  });

  it('gives the same generic error for every failure', async () => {
    const a = await make(new Error('secret detail'))
      .verifier.verify('Bearer t')
      .catch((e: Error) => e);
    const b = await make(good)
      .verifier.verify(undefined)
      .catch((e: Error) => e);
    expect((a as Error).message).toBe((b as Error).message);
  });
});
