import { beforeEach, describe, expect, it, vi } from 'vitest';

const lib = vi.hoisted(() => {
  const manager = {
    signinRedirect: vi.fn(() => Promise.resolve()),
    signinRedirectCallback: vi.fn(),
    signinSilent: vi.fn(),
    signoutRedirect: vi.fn(() => Promise.resolve()),
    removeUser: vi.fn(() => Promise.resolve()),
    getUser: vi.fn(),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      addUserSignedOut: vi.fn(),
      addSilentRenewError: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
      removeUserSignedOut: vi.fn(),
      removeSilentRenewError: vi.fn(),
    },
  };
  return { manager, ctor: vi.fn() };
});

vi.mock('oidc-client-ts', () => ({
  UserManager: class {
    constructor(settings: unknown) {
      lib.ctor(settings);
      return lib.manager;
    }
  },
  WebStorageStateStore: class {},
}));

const user = (over = {}) => ({
  expired: false,
  id_token: 'idt',
  profile: { sub: 'u1', email: 'a@b.co' },
  state: '/admin/events',
  ...over,
});

async function load() {
  vi.resetModules();
  return (await import('./oidc-backend')).oidcBackend;
}

beforeEach(() => {
  vi.stubEnv('VITE_OIDC_AUTHORITY', 'http://idp/realms/x');
  vi.stubEnv('VITE_OIDC_CLIENT_ID', 'web');
  Object.values(lib.manager).forEach(
    (f) => typeof f === 'function' && 'mockClear' in f && f.mockClear(),
  );
  lib.ctor.mockClear();
  lib.manager.getUser.mockReset().mockResolvedValue(user());
  lib.manager.signinSilent.mockReset().mockResolvedValue(user({ id_token: 'fresh' }));
});

describe('oidc backend', () => {
  it('uses the code flow with PKCE defaults and silent renew', async () => {
    const b = await load();
    await b.getIdToken();
    expect(lib.ctor).toHaveBeenCalledWith(
      expect.objectContaining({
        response_type: 'code',
        client_id: 'web',
        automaticSilentRenew: true,
        redirect_uri: `${window.location.origin}/auth/callback`,
      }),
    );
  });

  it('returns the stored ID token, null when expired, and a fresh one on forceRefresh', async () => {
    const b = await load();
    await expect(b.getIdToken()).resolves.toBe('idt');
    await expect(b.getIdToken(true)).resolves.toBe('fresh');
    lib.manager.getUser.mockResolvedValue(user({ expired: true }));
    await expect(b.getIdToken()).resolves.toBeNull();
  });

  it('treats a refused silent renew as signed out', async () => {
    const b = await load();
    lib.manager.signinSilent.mockRejectedValue(new Error('login_required'));
    await expect(b.getIdToken(true)).resolves.toBeNull();
  });

  it('redirects on signIn with the return path and login hint', async () => {
    const b = await load();
    void b.signIn('a@b.co', '', '/admin/events');
    await vi.waitFor(() => expect(lib.manager.signinRedirect).toHaveBeenCalled());
    expect(lib.manager.signinRedirect).toHaveBeenCalledWith({
      state: '/admin/events',
      login_hint: 'a@b.co',
    });
  });

  it('completes the callback and resolves the return path', async () => {
    const b = await load();
    lib.manager.signinRedirectCallback.mockResolvedValue(user());
    await expect(b.completeSignIn()).resolves.toBe('/admin/events');
    lib.manager.signinRedirectCallback.mockRejectedValue(new Error('bad state'));
    await expect(b.completeSignIn()).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('reports the restored session and signs out through the IdP', async () => {
    const b = await load();
    const seen: unknown[] = [];
    const stop = b.onAuthStateChanged((u) => seen.push(u));
    await vi.waitFor(() => expect(seen).toEqual([{ uid: 'u1', email: 'a@b.co' }]));
    stop();
    expect(lib.manager.events.removeUserLoaded).toHaveBeenCalled();
    await b.signOut();
    expect(lib.manager.signoutRedirect).toHaveBeenCalled();
  });

  it('fails as unknown without configuration', async () => {
    vi.stubEnv('VITE_OIDC_AUTHORITY', '');
    const b = await load();
    const onError = vi.fn();
    b.onAuthStateChanged(() => undefined, onError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unknown' }));
  });
});
