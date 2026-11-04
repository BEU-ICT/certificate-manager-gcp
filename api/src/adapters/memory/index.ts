import { AdapterError, type AdapterFactory, type Registries } from '../../compose.js';
import { FakeCertificateRepository } from '../../testing/fakes/fake-certificate-repository.js';
import { FakeEmailSender } from '../../testing/fakes/fake-email-sender.js';
import { FakeEventRepository } from '../../testing/fakes/fake-event-repository.js';
import { FakeOrganizationRepository } from '../../testing/fakes/fake-organization-repository.js';
import { FakeScheduler } from '../../testing/fakes/fake-scheduler.js';
import { FakeStorageGateway } from '../../testing/fakes/fake-storage-gateway.js';
import { FakeTaskQueue } from '../../testing/fakes/fake-task-queue.js';
import { FakeTemplateRepository } from '../../testing/fakes/fake-template-repository.js';
import { FakeTaskRequestVerifier, FakeTokenVerifier } from '../../testing/fakes/fake-verifiers.js';

/**
 * Local-profile adapters: the in-memory fakes double as the `memory` / `in-process` adapters
 * (BEU-ICT/certificate-manager#33). Vendor names that are only stand-ins here are refused in
 * production so a fake verifier or sender can never serve real traffic.
 */
function devOnly<P>(selector: string, name: string, factory: AdapterFactory<P>): AdapterFactory<P> {
  return (ctx) => {
    if (ctx.config.env === 'production') {
      throw new AdapterError(`${selector}: adapter "${name}" is not available in this build`);
    }
    return factory(ctx);
  };
}

export function registerMemoryAdapters(r: Registries): void {
  r.db.register('memory', () => ({
    organizations: new FakeOrganizationRepository(),
    events: new FakeEventRepository(),
    templates: new FakeTemplateRepository(),
    certificates: new FakeCertificateRepository(),
  }));
  r.storage.register('memory', () => new FakeStorageGateway());
  r.queue.register('in-process', () => ({
    taskQueue: new FakeTaskQueue(),
    scheduler: new FakeScheduler(),
  }));
  r.auth.register(
    'firebase',
    devOnly('AUTH_PROVIDER', 'firebase', () => ({
      tokenVerifier: new FakeTokenVerifier(),
      taskRequestVerifier: new FakeTaskRequestVerifier(),
    })),
  );
  for (const name of ['gmail', 'brevo']) {
    r.email.register(
      name,
      devOnly('EMAIL_PROVIDER', name, () => new FakeEmailSender()),
    );
  }
}
