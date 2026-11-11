import { beforeEach } from 'vitest';
import { FirestoreCertificateRepository } from '../../src/adapters/firestore/certificate-repository.js';
import { createFakes, type Fakes } from '../../src/testing/fakes/index.js';
import { describeCertificateBulkIssuanceApi } from '../helpers/certificate-bulk-issuance-api-suite.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeCertificateBulkIssuanceApi('Firestore adapter (emulator)', async () => {
  await resetFirestore();
  return {
    ...createFakes(),
    certificates: new FirestoreCertificateRepository(getTestFirestore()),
  } as unknown as Fakes;
});
