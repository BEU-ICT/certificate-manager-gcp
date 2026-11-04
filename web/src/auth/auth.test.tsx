import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authErrorKind, toAuthError } from './errors';
import { AuthError } from './types';

// The SDK is mocked: these tests never talk to Firebase.
const sdk = vi.hoisted(() => {
  const user = {
    uid: 'u1',
    email: 'admin@example.org',
    getIdToken: vi.fn<(force?: boolean) => Promise<string>>(),
  };
  const auth: {
    currentUser: typeof user | null;
    authStateReady: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
  } = {
    currentUser: user,
    authStateReady: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  return {
    user,
    auth,
    getAuth: vi.fn(() => auth),
    connectAuthEmulator: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    onAuthStateChanged: vi.fn(),
    initializeApp: vi.fn(() => ({})),
    getApps: vi.fn((): unknown[] => []),
  };
});

vi.mock('firebase/app', () => ({ initializeApp: sdk.initializeApp, getApps: sdk.getApps }));
vi.mock('firebase/auth', () => ({
  getAuth: sdk.getAuth,
  connectAuthEmulator: sdk.connectAuthEmulator,
  signInWithEmailAndPassword: sdk.signInWithEmailAndPassword,
  sendPasswordResetEmail: sdk.sendPasswordResetEmail,
  onAuthStateChanged: sdk.onAuthStateChanged,
}));

const firebaseError = (code: string) =>
  Object.assign(new Error(`Firebase: Error (${code}).`), { code });

// Fresh module state (cached SDK promise, auth store) per test.
async function load() {
  vi.resetModules();
  return import('./index');
}

beforeEach(() => {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key');
  vi.stubEnv('VITE_USE_AUTH_EMULATOR', 'false');
  sdk.auth.currentUser = sdk.user;
  sdk.user.getIdToken.mockReset().mockResolvedValue('token');
  sdk.signInWithEmailAndPassword.mockReset();
  sdk.sendPasswordResetEmail.mockReset().mockResolvedValue(undefined);
  sdk.onAuthStateChanged.mockReset();
  sdk.connectAuthEmulator.mockReset();
  sdk.auth.signOut.mockClear();
});

describe('error mapping', () => {
  it.each([
    ['auth/invalid-credential', 'invalidCredentials'],
    ['auth/wrong-password', 'invalidCredentials'],
    ['auth/user-not-found', 'invalidCredentials'],
    ['auth/invalid-email', 'invalidCredentials'],
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-disabled', 'disabled'],
    ['auth/internal-error', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%s -> %s', (code, kind) => {
    expect(authErrorKind(code)).toBe(kind);
  });

  it('wraps SDK errors without leaking their text and keeps the cause', () => {
    const cause = firebaseError('auth/wrong-password');
    const error = toAuthError(cause);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.kind).toBe('invalidCredentials');
    expect(error.message).toBe('Authentication failed: invalidCredentials');
    expect(error.cause).toBe(cause);
    expect(toAuthError(new TypeError('boom')).kind).toBe('unknown');
    expect(toAuthError(error)).toBe(error);
  });
});

describe('signIn', () => {
  it('returns the user on success', async () => {
    sdk.signInWithEmailAndPassword.mockResolvedValue({ user: sdk.user });
    const { signIn } = await load();
    await expect(signIn('admin@example.org', 'pw')).resolves.toEqual({
      uid: 'u1',
      email: 'admin@example.org',
    });
    expect(sdk.signInWithEmailAndPassword).toHaveBeenCalledWith(
      sdk.auth,
      'admin@example.org',
      'pw',
    );
  });

  it('gives wrong password and unknown user the same error kind', async () => {
    const { signIn } = await load();
    const kinds: string[] = [];
    for (const code of ['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential']) {
      sdk.signInWithEmailAndPassword.mockRejectedValueOnce(firebaseError(code));
      const failure = await signIn('a@b.co', 'x').then(
        () => undefined,
        (e: AuthError) => e,
      );
      kinds.push(failure?.kind ?? 'resolved');
    }
    expect(new Set(kinds)).toEqual(new Set(['invalidCredentials']));
  });

  it('maps rate limiting, network and disabled accounts', async () => {
    const { signIn } = await load();
    for (const [code, kind] of [
      ['auth/too-many-requests', 'tooManyRequests'],
      ['auth/network-request-failed', 'network'],
      ['auth/user-disabled', 'disabled'],
    ] as const) {
      sdk.signInWithEmailAndPassword.mockRejectedValueOnce(firebaseError(code));
      await expect(signIn('a@b.co', 'x')).rejects.toMatchObject({ kind });
    }
  });

  it('reports a missing Firebase configuration as unknown', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    sdk.getAuth.mockImplementationOnce(() => {
      throw firebaseError('auth/invalid-api-key');
    });
    const { signIn } = await load();
    await expect(signIn('a@b.co', 'x')).rejects.toMatchObject({ kind: 'unknown' });
  });
});

describe('sendPasswordReset', () => {
  it('resolves for an unknown or malformed address (no account enumeration)', async () => {
    const { sendPasswordReset } = await load();
    sdk.sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/user-not-found'));
    await expect(sendPasswordReset('nobody@example.org')).resolves.toBeUndefined();
    sdk.sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/invalid-email'));
    await expect(sendPasswordReset('nope')).resolves.toBeUndefined();
  });

  it('still rejects on network and rate-limit failures', async () => {
    const { sendPasswordReset } = await load();
    sdk.sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/network-request-failed'));
    await expect(sendPasswordReset('a@b.co')).rejects.toMatchObject({ kind: 'network' });
    sdk.sendPasswordResetEmail.mockRejectedValueOnce(firebaseError('auth/too-many-requests'));
    await expect(sendPasswordReset('a@b.co')).rejects.toMatchObject({ kind: 'tooManyRequests' });
  });
});

describe('getIdToken', () => {
  it('uses the cached token by default and forces a refresh when asked', async () => {
    const { getIdToken } = await load();
    await expect(getIdToken()).resolves.toBe('token');
    expect(sdk.user.getIdToken).toHaveBeenLastCalledWith(false);
    await expect(getIdToken(true)).resolves.toBe('token');
    expect(sdk.user.getIdToken).toHaveBeenLastCalledWith(true);
  });

  it('waits for the restored session and returns null when signed out', async () => {
    sdk.auth.currentUser = null;
    const { getIdToken } = await load();
    await expect(getIdToken()).resolves.toBeNull();
    expect(sdk.auth.authStateReady).toHaveBeenCalled();
  });

  it('maps refresh failures', async () => {
    sdk.user.getIdToken.mockRejectedValue(firebaseError('auth/network-request-failed'));
    const { getIdToken } = await load();
    await expect(getIdToken(true)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('signOut and emulator', () => {
  it('signs out through the SDK', async () => {
    const { signOut } = await load();
    await signOut();
    expect(sdk.auth.signOut).toHaveBeenCalledOnce();
  });

  it('connects to the Auth emulator only when VITE_USE_AUTH_EMULATOR=true', async () => {
    const { getIdToken } = await load();
    await getIdToken();
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();

    vi.stubEnv('VITE_USE_AUTH_EMULATOR', 'true');
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    const again = await load();
    await again.getIdToken();
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(
      sdk.auth,
      'http://127.0.0.1:9099',
      expect.anything(),
    );
  });
});

describe('onAuthStateChanged and useAuth', () => {
  it('unsubscribes from the SDK, also when called before the SDK loaded', async () => {
    const stop = vi.fn();
    sdk.onAuthStateChanged.mockReturnValue(stop);
    const { onAuthStateChanged } = await load();
    const unsubscribe = onAuthStateChanged(vi.fn());
    await vi.waitFor(() => expect(sdk.onAuthStateChanged).toHaveBeenCalled());
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();

    const early = onAuthStateChanged(vi.fn());
    early();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sdk.onAuthStateChanged).toHaveBeenCalledOnce();
  });

  it('exposes loading, then signedIn and signedOut', async () => {
    let emit: (user: unknown) => void = () => undefined;
    sdk.onAuthStateChanged.mockImplementation((_auth: unknown, cb: (user: unknown) => void) => {
      emit = cb;
      return vi.fn();
    });
    const { useAuth } = await load();
    const { result } = renderHook(() => useAuth());
    expect(result.current).toEqual({ status: 'loading', user: null });

    await vi.waitFor(() => expect(sdk.onAuthStateChanged).toHaveBeenCalled());
    act(() => emit(sdk.user));
    expect(result.current).toEqual({
      status: 'signedIn',
      user: { uid: 'u1', email: 'admin@example.org' },
    });
    act(() => emit(null));
    expect(result.current).toEqual({ status: 'signedOut', user: null });
  });

  it('falls back to signedOut when Firebase cannot be configured', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '');
    sdk.getAuth.mockImplementationOnce(() => {
      throw firebaseError('auth/invalid-api-key');
    });
    const { useAuth } = await load();
    const { result } = renderHook(() => useAuth());
    await vi.waitFor(() => expect(result.current.status).toBe('signedOut'));
  });
});
