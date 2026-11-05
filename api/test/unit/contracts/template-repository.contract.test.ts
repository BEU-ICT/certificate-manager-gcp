import { describeTemplateRepositoryContract } from '../../../src/testing/contracts/index.js';
import { FakeTemplateRepository } from '../../../src/testing/fakes/index.js';

describeTemplateRepositoryContract('FakeTemplateRepository', () => ({
  adapter: new FakeTemplateRepository(),
  cleanup: () => undefined,
}));
