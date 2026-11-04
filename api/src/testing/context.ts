import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { AdminIdentity } from '../ports/index.js';
import { createFakes, type Fakes } from './fakes/create-fakes.js';
import { TEST_ADMIN, TEST_ADMIN_TOKEN, TEST_TASK_CREDENTIAL } from './fakes/fake-verifiers.js';

export interface TestContext {
  app: FastifyInstance;
  /** The concrete fakes, with their recording and control methods. */
  fakes: Fakes;
  admin: AdminIdentity;
  /** `Authorization` header value accepted as the test admin. */
  adminAuthorization: string;
  /** `Authorization` header value accepted on `/internal/**` task calls. */
  taskAuthorization: string;
  close(): Promise<void>;
}

/** Builds the app wired to fresh in-memory fakes and a test admin identity. */
export function createTestContext(overrides: Partial<Fakes> = {}): TestContext {
  const fakes: Fakes = { ...createFakes(), ...overrides };
  const app = buildApp({ ports: fakes });
  return {
    app,
    fakes,
    admin: TEST_ADMIN,
    adminAuthorization: `Bearer ${TEST_ADMIN_TOKEN}`,
    taskAuthorization: TEST_TASK_CREDENTIAL,
    close: () => app.close(),
  };
}
