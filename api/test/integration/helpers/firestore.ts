import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { FIRESTORE_HOST, PROJECT_ID } from './emulator.js';

const APP_NAME = 'integration-tests';

/** Firestore client bound to the emulator (the host comes from FIRESTORE_EMULATOR_HOST). */
export function getTestFirestore(): Firestore {
  const app =
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp({ projectId: PROJECT_ID }, APP_NAME);
  return getFirestore(app);
}

/**
 * Deletes every document in the emulator's `(default)` database through its REST clear endpoint.
 * Call it in `beforeEach` (or `beforeAll`); test files run sequentially, so a reset never races
 * with another file.
 */
export async function resetFirestore(): Promise<void> {
  const url = `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`resetFirestore failed: HTTP ${res.status} ${await res.text()}`);
  }
}
