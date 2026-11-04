import type { Auth } from 'firebase/auth';

/**
 * The only place that loads the Firebase SDK. Both modules are dynamically imported, so the SDK
 * is fetched when an `/admin/*` or `/login` route first needs it and lands in its own chunk.
 *
 * Persistence is the SDK default (IndexedDB, falling back to localStorage): the session survives
 * reloads and is shared between tabs. Trade-off: an XSS bug could read it, which the CSP (#166)
 * mitigates. Our code never copies the token anywhere else.
 */
let pending: Promise<Auth> | undefined;

const EMULATOR_URL = 'http://127.0.0.1:9099';

async function init(): Promise<Auth> {
  const emulator = import.meta.env.VITE_USE_AUTH_EMULATOR === 'true';
  // The emulator ignores the key, but the SDK refuses an empty one. A missing configuration is
  // left to the SDK to reject (`auth/invalid-api-key`), which keeps this code reachable by the
  // bundler even in a build without VITE_FIREBASE_* (CI), so `check:bundle` can see the chunk.
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || (emulator ? 'emulator-key' : '');

  const [{ getApps, initializeApp }, { connectAuthEmulator, getAuth }] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
      projectId:
        import.meta.env.VITE_FIREBASE_PROJECT_ID || (emulator ? 'demo-certificate-manager' : ''),
    });
  const auth = getAuth(app);
  if (emulator) connectAuthEmulator(auth, EMULATOR_URL, { disableWarnings: true });
  return auth;
}

/** Initialises Firebase once; a failed initialisation can be retried by the next call. */
export function loadAuth(): Promise<Auth> {
  pending ??= init().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

/** Starts loading the SDK without waiting for it (call from route code to warm the chunk). */
export function preloadAuth(): void {
  loadAuth().catch(() => undefined);
}
