import { beforeEach } from 'vitest';
import { FirestoreCertificateRepository } from '../../src/adapters/firestore/certificate-repository.js';
import { describeCertificateRepositoryContract } from '../../src/testing/contracts/index.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeCertificateRepositoryContract('FirestoreCertificateRepository (emulator)', async () => {
  await resetFirestore();
  return {
    adapter: new FirestoreCertificateRepository(getTestFirestore()),
    cleanup: () => undefined,
  };
});
