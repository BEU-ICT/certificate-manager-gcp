import { beforeEach } from 'vitest';
import { FirestoreEventRepository } from '../../src/adapters/firestore/event-repository.js';
import { FirestoreOrganizationRepository } from '../../src/adapters/firestore/organization-repository.js';
import { FirestoreTemplateRepository } from '../../src/adapters/firestore/template-repository.js';
import { createFakes, type Fakes } from '../../src/testing/fakes/index.js';
import { describeTemplatesApi } from '../helpers/templates-api-suite.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeTemplatesApi('Firestore adapters (emulator)', async () => {
  await resetFirestore();
  const db = getTestFirestore();
  return {
    ...createFakes(),
    organizations: new FirestoreOrganizationRepository(db),
    events: new FirestoreEventRepository(db),
    templates: new FirestoreTemplateRepository(db),
  } as unknown as Fakes;
});
