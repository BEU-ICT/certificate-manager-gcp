import { beforeEach } from 'vitest';
import { FirestoreCertificateRepository } from '../../src/adapters/firestore/certificate-repository.js';
import { createFakes, type Fakes } from '../../src/testing/fakes/index.js';
import { describeCertificateRevocationApi } from '../helpers/certificate-revocation-api-suite.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeCertificateRevocationApi('Firestore adapter (emulator)', async () => {
  await resetFirestore();
  return {
    ...createFakes(),
    certificates: new FirestoreCertificateRepository(getTestFirestore()),
  } as unknown as Fakes;
});
