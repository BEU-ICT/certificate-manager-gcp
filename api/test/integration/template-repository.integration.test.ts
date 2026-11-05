import { beforeEach } from 'vitest';
import { FirestoreTemplateRepository } from '../../src/adapters/firestore/template-repository.js';
import { describeTemplateRepositoryContract } from '../../src/testing/contracts/index.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeTemplateRepositoryContract('FirestoreTemplateRepository (emulator)', async () => {
  await resetFirestore();
  return {
    adapter: new FirestoreTemplateRepository(getTestFirestore()),
    cleanup: () => undefined,
  };
});
