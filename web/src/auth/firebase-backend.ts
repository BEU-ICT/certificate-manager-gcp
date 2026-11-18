import { loadAuth, preloadAuth } from './firebase';
import type { AuthBackend } from './provider';
import { getIdToken, onAuthStateChanged, sendPasswordReset, signIn, signOut } from './service';

export const firebaseBackend: AuthBackend = {
  signIn,
  signOut,
  sendPasswordReset,
  onAuthStateChanged,
  getIdToken,
  preload: preloadAuth,
  completeSignIn: async () => {
    await loadAuth();
    return null;
  },
};
