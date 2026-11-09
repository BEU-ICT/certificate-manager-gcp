import { beforeEach } from 'vitest';
import { FirestoreCertificateRepository } from '../../src/adapters/firestore/certificate-repository.js';
import { FirestoreEventRepository } from '../../src/adapters/firestore/event-repository.js';
import { FirestoreOrganizationRepository } from '../../src/adapters/firestore/organization-repository.js';
import { createFakes, type Fakes } from '../../src/testing/fakes/index.js';
import { describeStatsApi } from '../helpers/stats-api-suite.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeStatsApi('Firestore adapter (emulator)', async () => {
  await resetFirestore();
  const db = getTestFirestore();
  return {
    ...createFakes(),
    certificates: new FirestoreCertificateRepository(db),
    organizations: new FirestoreOrganizationRepository(db),
    events: new FirestoreEventRepository(db),
  } as unknown as Fakes;
});
