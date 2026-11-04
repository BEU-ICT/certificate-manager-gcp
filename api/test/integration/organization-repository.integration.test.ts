import { beforeEach } from 'vitest';
import { FirestoreOrganizationRepository } from '../../src/adapters/firestore/organization-repository.js';
import { describeOrganizationRepositoryContract } from '../../src/testing/contracts/index.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeOrganizationRepositoryContract('FirestoreOrganizationRepository (emulator)', async () => {
  await resetFirestore();
  return {
    adapter: new FirestoreOrganizationRepository(getTestFirestore()),
    cleanup: () => undefined,
  };
});
