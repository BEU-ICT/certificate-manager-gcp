import { FakeCertificateRepository } from './fake-certificate-repository.js';
import { FakeClock } from './fake-clock.js';
import { FakeEmailSender } from './fake-email-sender.js';
import { FakeEventBus } from './fake-event-bus.js';
import { FakeEventRepository } from './fake-event-repository.js';
import { FakeIdGenerator } from './fake-id-generator.js';
import { FakeOrganizationRepository } from './fake-organization-repository.js';
import { FakeRateLimiter } from './fake-rate-limiter.js';
import { FakeScheduler } from './fake-scheduler.js';
import { FakeStorageGateway } from './fake-storage-gateway.js';
import { FakeTaskQueue } from './fake-task-queue.js';
import { FakeTemplateRepository } from './fake-template-repository.js';
import { FakeTaskRequestVerifier, FakeTokenVerifier } from './fake-verifiers.js';

/** One fresh instance of every fake; the rate limiter shares the clock. */
export function createFakes() {
  const clock = new FakeClock();
  return {
    clock,
    ids: new FakeIdGenerator(),
    organizations: new FakeOrganizationRepository(),
    events: new FakeEventRepository(),
    templates: new FakeTemplateRepository(),
    certificates: new FakeCertificateRepository(),
    storage: new FakeStorageGateway(),
    taskQueue: new FakeTaskQueue(),
    scheduler: new FakeScheduler(),
    emailSender: new FakeEmailSender(),
    rateLimiter: new FakeRateLimiter(clock),
    eventBus: new FakeEventBus(),
    tokenVerifier: new FakeTokenVerifier(),
    taskRequestVerifier: new FakeTaskRequestVerifier(),
  };
}

export type Fakes = ReturnType<typeof createFakes>;
