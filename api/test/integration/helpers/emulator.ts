/**
 * Emulator coordinates. `firebase emulators:exec` exports these variables (values come from
 * firebase.json); the fallbacks match firebase.json so a test can also run against emulators
 * started by hand (`npx firebase emulators:start --only firestore,auth`).
 */
export const PROJECT_ID = process.env['GCLOUD_PROJECT'] ?? 'demo-certificate-manager';
export const FIRESTORE_HOST = process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8081';
export const AUTH_HOST = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099';

// firebase-admin and the REST helpers must talk to the emulators, never to a real project.
process.env['GCLOUD_PROJECT'] = PROJECT_ID;
process.env['FIRESTORE_EMULATOR_HOST'] = FIRESTORE_HOST;
process.env['FIREBASE_AUTH_EMULATOR_HOST'] = AUTH_HOST;
