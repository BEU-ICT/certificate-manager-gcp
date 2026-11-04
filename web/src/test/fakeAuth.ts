import { vi } from 'vitest';
import type { AuthState, AuthUser } from '@/auth';

/**
 * Stand-in for the `auth` module in component tests: a tiny observable store behind `useAuth` plus
 * spies for the operations. Use it from the `vi.mock('@/auth', …)` factory, for example:
 *
 *   vi.mock('@/auth', async (importOriginal) => {
 *     const { authMockModule } = await import('@/test/fakeAuth');
 *     return authMockModule(await importOriginal());
 *   });
 */
export const ADMIN_USER: AuthUser = { uid: 'u1', email: 'admin@example.org' };

const listeners = new Set<() => void>();
const SIGNED_OUT: AuthState = { status: 'signedOut', user: null };

export const fakeAuth = {
  state: SIGNED_OUT,
  /** Replace the state and notify subscribers (also simulates a change made in another tab). */
  set: (next: AuthState) => {
    fakeAuth.state = next;
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => fakeAuth.state,
  signIn: vi.fn<(email: string, password: string) => Promise<AuthUser>>(),
  signOut: vi.fn<() => Promise<void>>(),
  sendPasswordReset: vi.fn<(email: string) => Promise<void>>(),
  getIdToken: vi.fn<(forceRefresh?: boolean) => Promise<string | null>>(),
  /** Defaults: sign-in and sign-out flip the store, tokens are available. Call in `beforeEach`. */
  reset: (state: AuthState = SIGNED_OUT) => {
    fakeAuth.state = state;
    fakeAuth.signIn.mockReset().mockImplementation(() => {
      fakeAuth.set({ status: 'signedIn', user: ADMIN_USER });
      return Promise.resolve(ADMIN_USER);
    });
    fakeAuth.signOut.mockReset().mockImplementation(() => {
      fakeAuth.set(SIGNED_OUT);
      return Promise.resolve();
    });
    fakeAuth.sendPasswordReset.mockReset().mockResolvedValue(undefined);
    fakeAuth.getIdToken.mockReset().mockResolvedValue('tok');
  },
};

export const SIGNED_IN: AuthState = { status: 'signedIn', user: ADMIN_USER };

export async function authMockModule(actual: typeof import('@/auth')) {
  const { useSyncExternalStore } = await import('react');
  return {
    ...actual,
    useAuth: () => useSyncExternalStore(fakeAuth.subscribe, fakeAuth.getSnapshot),
    preloadAuth: vi.fn(),
    signIn: fakeAuth.signIn,
    signOut: fakeAuth.signOut,
    sendPasswordReset: fakeAuth.sendPasswordReset,
    getIdToken: fakeAuth.getIdToken,
  };
}
