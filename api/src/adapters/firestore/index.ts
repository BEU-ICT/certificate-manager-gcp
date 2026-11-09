import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { RepositoryPorts } from '../../wiring.js';
import { SystemClock } from '../system/clock.js';
import type { AdapterContext } from '../registry.js';
import { FirestoreCertificateRepository } from './certificate-repository.js';
import { FirestoreEventRepository } from './event-repository.js';
import { FirestoreIdempotencyStore } from './idempotency-store.js';
import { FirestoreMigrationStateStore } from './migration-state-store.js';
import { FirestoreOrganizationRepository } from './organization-repository.js';
import { FirestoreTemplateRepository } from './template-repository.js';

const APP_NAME = 'certificate-manager-firestore';

/**
 * `DB_ADAPTER=firestore`. Honours FIRESTORE_EMULATOR_HOST through the Admin SDK.
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
    idempotency: new FirestoreIdempotencyStore(db, new SystemClock()),
  };
}
