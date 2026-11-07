import { describeCertificateRepositoryContract } from '../../../src/testing/contracts/index.js';
import { FakeCertificateRepository } from '../../../src/testing/fakes/index.js';

describeCertificateRepositoryContract('FakeCertificateRepository', () => ({
  adapter: new FakeCertificateRepository(),
  cleanup: () => undefined,
}));
