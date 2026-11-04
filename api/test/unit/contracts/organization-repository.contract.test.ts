import { describeOrganizationRepositoryContract } from '../../../src/testing/contracts/index.js';
import { FakeOrganizationRepository } from '../../../src/testing/fakes/index.js';

describeOrganizationRepositoryContract('FakeOrganizationRepository', () => ({
  adapter: new FakeOrganizationRepository(),
  cleanup: () => undefined,
}));
