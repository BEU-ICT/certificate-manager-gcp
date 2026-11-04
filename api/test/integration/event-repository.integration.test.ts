import { beforeEach } from 'vitest';
import { FirestoreEventRepository } from '../../src/adapters/firestore/event-repository.js';
import { describeEventRepositoryContract } from '../../src/testing/contracts/index.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeEventRepositoryContract('FirestoreEventRepository (emulator)', async () => {
  await resetFirestore();
  return {
    adapter: new FirestoreEventRepository(getTestFirestore()),
    cleanup: () => undefined,
  };
});
