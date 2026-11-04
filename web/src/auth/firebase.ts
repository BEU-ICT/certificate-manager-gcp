import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { getApps, initializeApp } from 'firebase/app';

let auth: Auth | undefined;

/** The only place that touches the Firebase SDK. Loaded lazily with the admin bundle. */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const app =
    getApps()[0] ??
    initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    });
  auth = getAuth(app);
  if (import.meta.env.VITE_USE_AUTH_EMULATOR === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return auth;
}
