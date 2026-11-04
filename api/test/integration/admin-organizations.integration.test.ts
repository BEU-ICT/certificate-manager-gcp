import { beforeEach } from 'vitest';
import { FirestoreOrganizationRepository } from '../../src/adapters/firestore/organization-repository.js';
import { createFakes, type Fakes } from '../../src/testing/fakes/index.js';
import { describeOrganizationsApi } from '../helpers/organizations-api-suite.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeOrganizationsApi('Firestore adapter (emulator)', async () => {
  await resetFirestore();
  return {
    ...createFakes(),
    organizations: new FirestoreOrganizationRepository(getTestFirestore()),
  } as unknown as Fakes;
});
