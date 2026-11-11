import { SystemClock } from '../system/clock.js';
import { AdapterError, type AdapterFactory, type Registries } from '../registry.js';
import { FakeCertificateRepository } from '../../testing/fakes/fake-certificate-repository.js';
import { FakeEmailSender } from '../../testing/fakes/fake-email-sender.js';
import { FakeEventRepository } from '../../testing/fakes/fake-event-repository.js';
import { FakeIdempotencyStore } from '../../testing/fakes/fake-idempotency-store.js';
import { FakeMigrationStateStore } from '../../testing/fakes/fake-migration-state-store.js';
import { FakeOrganizationRepository } from '../../testing/fakes/fake-organization-repository.js';
import { FakeScheduler } from '../../testing/fakes/fake-scheduler.js';
import { FakeStorageGateway } from '../../testing/fakes/fake-storage-gateway.js';
import { FakeTaskQueue } from '../../testing/fakes/fake-task-queue.js';
import { FakeAdminUserDirectory } from '../../testing/fakes/fake-admin-user-directory.js';
import { FakeTaskRequestVerifier, FakeTokenVerifier } from '../../testing/fakes/fake-verifiers.js';
import { FakeTemplateRepository } from '../../testing/fakes/fake-template-repository.js';

/**
 * Local-profile adapters: the in-memory fakes double as the `memory` / `in-process` adapters
 * (BEU-ICT/certificate-manager#245). Vendor names that are only stand-ins here are refused in
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
    migrationState: new FakeMigrationStateStore(new SystemClock()),
    idempotency: new FakeIdempotencyStore(new SystemClock()),
  }));
  r.storage.register('memory', () => new FakeStorageGateway());
  r.queue.register('in-process', () => ({
    taskQueue: new FakeTaskQueue(),
    scheduler: new FakeScheduler(),
  }));
  // The local profile without an Auth emulator keeps the in-memory verifier so that
  // `npm run dev:lite` works offline; production and emulator runs get the real Firebase adapter.
  r.auth.register('firebase', async (ctx) => {
    if (ctx.config.env === 'production' || process.env['FIREBASE_AUTH_EMULATOR_HOST']) {
      return (await import('../firebase/index.js')).createAuthPorts(ctx);
    }
    return {
      tokenVerifier: new FakeTokenVerifier(),
      taskRequestVerifier: new FakeTaskRequestVerifier(),
      adminUsers: new FakeAdminUserDirectory(),
    };
  });
  for (const name of ['gmail', 'brevo']) {
    r.email.register(
      name,
      devOnly('EMAIL_PROVIDER', name, () => new FakeEmailSender()),
    );
  }
}
