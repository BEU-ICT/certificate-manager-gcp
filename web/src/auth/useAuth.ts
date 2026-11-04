import { useSyncExternalStore } from 'react';
import { onAuthStateChanged } from './service';
import type { AuthState, Unsubscribe } from './types';

const SIGNED_OUT: AuthState = { status: 'signedOut', user: null };

let state: AuthState = { status: 'loading', user: null };
const listeners = new Set<() => void>();
let stopSdk: Unsubscribe | undefined;

function publish(next: AuthState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function start(): void {
  stopSdk = onAuthStateChanged(
    (user) => publish(user ? { status: 'signedIn', user } : SIGNED_OUT),
    // No usable Firebase configuration or SDK load failure: nobody can be signed in.
    () => publish(SIGNED_OUT),
  );
}

function subscribe(listener: () => void): Unsubscribe {
  if (listeners.size === 0) start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopSdk?.();
      stopSdk = undefined;
    }
  };
}

const getSnapshot = (): AuthState => state;

/** Current auth state; `loading` until the persisted session has been restored. */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
