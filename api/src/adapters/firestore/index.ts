import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { RepositoryPorts } from '../../wiring.js';
import { SystemClock } from '../system/clock.js';
import type { AdapterContext } from '../registry.js';
import { FirestoreCertificateRepository } from './certificate-repository.js';
import { FirestoreEventRepository } from './event-repository.js';
import { FirestoreMigrationStateStore } from './migration-state-store.js';
import { FirestoreOrganizationRepository } from './organization-repository.js';
import { FirestoreTemplateRepository } from './template-repository.js';

const APP_NAME = 'certificate-manager-firestore';

/** A repository whose Firestore implementation has not landed yet: every call fails loudly. */
function notImplemented<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, method) => () =>
      Promise.reject(new Error(`${name}.${String(method)} is not implemented for Firestore yet`)),
  });
}

/**
 * `DB_ADAPTER=firestore`. Honours FIRESTORE_EMULATOR_HOST through the Admin SDK. Each epic replaces
 * one `notImplemented` entry with its adapter.
 */
export function createRepositories({ config }: AdapterContext): RepositoryPorts {
  const app =
    getApps().find((a) => a.name === APP_NAME) ??
    initializeApp({ projectId: config.gcpProject }, APP_NAME);
  const db = getFirestore(app);
  return {
    organizations: new FirestoreOrganizationRepository(db),
    events: new FirestoreEventRepository(db),
    templates: new FirestoreTemplateRepository(db),
    certificates: new FirestoreCertificateRepository(db),
    migrationState: new FirestoreMigrationStateStore(db, new SystemClock()),
  };
}
