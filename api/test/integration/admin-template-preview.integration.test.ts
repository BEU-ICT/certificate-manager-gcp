import { beforeEach } from 'vitest';
import { FirestoreEventRepository } from '../../src/adapters/firestore/event-repository.js';
import { FirestoreOrganizationRepository } from '../../src/adapters/firestore/organization-repository.js';
import { FirestoreTemplateRepository } from '../../src/adapters/firestore/template-repository.js';
import { createFakes, type Fakes } from '../../src/testing/fakes/index.js';
import { describeTemplatePreviewApi } from '../helpers/template-preview-suite.js';
import { getTestFirestore, resetFirestore } from './helpers/index.js';

beforeEach(resetFirestore);

describeTemplatePreviewApi('Firestore adapters (emulator) + in-memory storage', async () => {
  await resetFirestore();
  const db = getTestFirestore();
  return {
    ...createFakes(),
    organizations: new FirestoreOrganizationRepository(db),
    events: new FirestoreEventRepository(db),
    templates: new FirestoreTemplateRepository(db),
  } as unknown as Fakes;
});
