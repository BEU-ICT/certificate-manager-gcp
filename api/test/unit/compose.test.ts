import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  AdapterError,
  AdapterRegistry,
  compose,
  defaultRegistries,
  selectAdapters,
  type Registries,
} from '../../src/compose.js';
import { loadConfig } from '../../src/config.js';
import { TEMPLATES_BUCKET, templateKey } from '../../src/modules/templates/index.js';
import { asTemplateRef } from '../../src/shared/ids.js';
import {
  sampleEvent,
  sampleOrganization,
  sampleTemplate,
} from '../../src/testing/contracts/index.js';
import { fakeToken } from '../../src/testing/fakes/index.js';
import type { EmailSender, StorageGateway } from '../../src/ports/index.js';
import type { AuthPorts, QueuePorts, RepositoryPorts } from '../../src/wiring.js';

const stub = <T>(tag: string): T => ({ tag }) as unknown as T;
const dbStub = (tag: string): RepositoryPorts => ({
  organizations: stub(tag),
  events: stub(tag),
  templates: stub(tag),
  certificates: stub(tag),
  migrationState: stub(tag),
  idempotency: stub(tag),
  emailQuota: stub(tag),
});
const queueStub = (tag: string): QueuePorts => ({ taskQueue: stub(tag), scheduler: stub(tag) });
const authStub = (tag: string): AuthPorts => ({
  tokenVerifier: stub(tag),
  taskRequestVerifier: stub(tag),
  adminUsers: stub(tag),
});

const PROD_ENV = {
  NODE_ENV: 'production',
  GCP_PROJECT: 'p',
  SERVICE_URL: 'https://api.example.com',
  PUBLIC_BASE_URL: 'https://example.com',
  PDF_PUBLIC_BASE_URL: 'https://pdf.example.com',
  TEMPLATES_BUCKET: 't',
  PDF_BUCKET: 'b',
  TASKS_QUEUE: 'q',
  TASKS_LOCATION: 'us-east1',
  TASKS_INVOKER_SA: 'sa@p.iam.gserviceaccount.com',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  EMAIL_PROVIDER: 'gmail',
  EMAIL_FROM_ADDRESS: 'c@example.com',
  DB_ADAPTER: 'firestore',
  STORAGE_ADAPTER: 'gcs',
  QUEUE_ADAPTER: 'cloud-tasks',
  AUTH_PROVIDER: 'firebase',
};

function stubRegistries(): Registries {
  const r = defaultRegistries();
  r.db.register('firestore', () => dbStub('firestore'));
  r.db.register('memory', () => dbStub('memory-db'));
  r.storage.register('gcs', () => stub<StorageGateway>('gcs'));
  r.storage.register('fs', () => stub<StorageGateway>('fs'));
  r.storage.register('memory', () => stub<StorageGateway>('memory-storage'));
  r.queue.register('cloud-tasks', () => queueStub('cloud-tasks'));
  r.queue.register('in-process', () => queueStub('in-process'));
  r.auth.register('firebase', () => authStub('firebase'));
  r.email.register('gmail', () => stub<EmailSender>('gmail'));
  r.email.register('brevo', () => stub<EmailSender>('brevo'));
  return r;
}

describe('AdapterRegistry', () => {
  const ctx = { config: loadConfig({}) };

  it('returns the registered instance for a known name', async () => {
    const instance = { id: 1 };
    const reg = new AdapterRegistry<object>('DB_ADAPTER', ['a', 'b']).register('a', () => instance);
    await expect(reg.resolve('a', ctx)).resolves.toBe(instance);
  });

  it('awaits async factories', async () => {
    const reg = new AdapterRegistry<string>('X', ['a']).register('a', () => Promise.resolve('v'));
    await expect(reg.resolve('a', ctx)).resolves.toBe('v');
  });

  it('rejects an unknown name and lists the allowed names', async () => {
    const reg = new AdapterRegistry<object>('DB_ADAPTER', ['firestore', 'memory']);
    const err = await reg.resolve('mysql', ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as Error).message).toBe(
      'DB_ADAPTER: unknown adapter "mysql" (allowed: firestore, memory)',
    );
  });

  it('refuses to register a name outside the allowed set', () => {
    const reg = new AdapterRegistry<object>('DB_ADAPTER', ['memory']);
    expect(() => reg.register('mysql', () => ({}))).toThrow(/unknown adapter "mysql"/);
  });

  it('reports allowed-but-unimplemented names as not available in this build', async () => {
    const reg = new AdapterRegistry<object>('STORAGE_ADAPTER', ['gcs', 'fs']).register(
      'fs',
      () => ({}),
    );
    await expect(reg.resolve('gcs', ctx)).rejects.toThrow(
      'STORAGE_ADAPTER: adapter "gcs" is not available in this build (available: fs)',
    );
  });

  it('does not run a factory until it is resolved (lazy)', () => {
    let calls = 0;
    new AdapterRegistry<object>('X', ['a']).register('a', () => {
      calls += 1;
      return {};
    });
    expect(calls).toBe(0);
  });
});

describe('default registries', () => {
  it('compose the local profile from the in-memory adapters', async () => {
    const { ports } = await compose(loadConfig({ NODE_ENV: 'development' }));
    expect(ports.organizations).toBeDefined();
    expect(ports.tokenVerifier).toBeDefined();
    const app = buildApp({ ports });
    const res = await app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('fail with a clear message for names that have no implementation yet', async () => {
    await expect(compose(loadConfig(PROD_ENV))).rejects.toThrow(/not available in this build/);
  });

  it('never serve stand-in senders in production', async () => {
    const env = { ...PROD_ENV, DB_ADAPTER: 'firestore' };
    const regs = defaultRegistries();
    regs.db.register('firestore', () => dbStub('firestore'));
    regs.storage.register('gcs', () => stub<StorageGateway>('gcs'));
    regs.queue.register('cloud-tasks', () => queueStub('cloud-tasks'));
    await expect(compose(loadConfig(env), regs)).rejects.toThrow(
      'EMAIL_PROVIDER: adapter "gmail" is not available in this build',
    );
  });
});

describe('selectAdapters', () => {
  it('uses the config values', () => {
    expect(selectAdapters(loadConfig(PROD_ENV))).toMatchObject({
      db: 'firestore',
      storage: 'gcs',
      queue: 'cloud-tasks',
      auth: 'firebase',
      email: 'gmail',
    });
  });

  it('uses memory/in-process defaults in the local profile', () => {
    expect(selectAdapters(loadConfig({ NODE_ENV: 'development' }))).toMatchObject({
      db: 'memory',
      storage: 'memory',
      queue: 'in-process',
    });
  });

  it('switches to Firestore when its emulator is configured in development', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(selectAdapters(config, { FIRESTORE_EMULATOR_HOST: 'localhost:8081' }).db).toBe(
      'firestore',
    );
  });

  it('keeps an explicit DB_ADAPTER even when the emulator is configured', () => {
    const config = loadConfig({ NODE_ENV: 'development', DB_ADAPTER: 'memory' });
    const env = { FIRESTORE_EMULATOR_HOST: 'localhost:8081', DB_ADAPTER: 'memory' };
    expect(selectAdapters(config, env).db).toBe('memory');
  });

  it('ignores emulators outside development', () => {
    expect(selectAdapters(loadConfig(PROD_ENV), { FIRESTORE_EMULATOR_HOST: 'x:1' }).db).toBe(
      'firestore',
    );
    expect(
      selectAdapters(loadConfig({ NODE_ENV: 'test' }), { FIRESTORE_EMULATOR_HOST: 'x:1' }).db,
    ).toBe('memory');
  });

  it('selects the fallback e-mail provider only when the flag is on', () => {
    const on = loadConfig({ ...PROD_ENV, EMAIL_FALLBACK_PROVIDER: 'brevo', EMAIL_API_KEY: 'k' });
    expect(selectAdapters(on).emailFallback).toBe('brevo');
    const off = loadConfig({
      ...PROD_ENV,
      EMAIL_FALLBACK_PROVIDER: 'brevo',
      EMAIL_API_KEY: 'k',
      FEATURE_EMAIL_FALLBACK: 'false',
    });
    expect(selectAdapters(off).emailFallback).toBeUndefined();
  });
});

describe('compose', () => {
  it('builds all ports from config via the registries', async () => {
    const { ports, config } = await compose(
      loadConfig({ ...PROD_ENV, EMAIL_FALLBACK_PROVIDER: 'brevo', EMAIL_API_KEY: 'k' }),
      stubRegistries(),
    );
    expect(config.env).toBe('production');
    expect(ports.organizations).toEqual({ tag: 'firestore' });
    expect(ports.storage).toEqual({ tag: 'gcs' });
    expect(ports.taskQueue).toEqual({ tag: 'cloud-tasks' });
    expect(ports.tokenVerifier).toEqual({ tag: 'firebase' });
    expect(ports.emailSender).toEqual({ tag: 'gmail' });
    expect(ports.emailFallback).toEqual({ tag: 'brevo' });
  });

  it('only runs the factories of selected adapters', async () => {
    const regs = stubRegistries();
    let touched = false;
    regs.db.register('memory', () => {
      touched = true;
      return dbStub('x');
    });
    await compose(loadConfig(PROD_ENV), regs);
    expect(touched).toBe(false);
  });

  it('uses emulator selection in the local profile', async () => {
    const { ports } = await compose(loadConfig({ NODE_ENV: 'development' }), stubRegistries(), {
      FIRESTORE_EMULATOR_HOST: 'localhost:8081',
    });
    expect(ports.organizations).toEqual({ tag: 'firestore' });
    expect(ports.storage).toEqual({ tag: 'memory-storage' });
  });

  it('fails at boot naming the unavailable adapter', async () => {
    const partial: Registries = {
      ...stubRegistries(),
      storage: new AdapterRegistry<StorageGateway>('STORAGE_ADAPTER', ['gcs', 'fs', 'memory']),
    };
    await expect(compose(loadConfig(PROD_ENV), partial)).rejects.toThrow(
      'STORAGE_ADAPTER: adapter "gcs" is not available in this build',
    );
  });

  it('composes the production profile with lazy stub factories within 150 ms', async () => {
    const regs = defaultRegistries();
    // Each factory performs a dynamic import() like a real lazy adapter would.
    const lazy =
      <T>(tag: string) =>
      async (): Promise<T> => {
        await import('node:path');
        return stub<T>(tag);
      };
    regs.db.register('firestore', lazy<RepositoryPorts>('firestore'));
    regs.storage.register('gcs', lazy<StorageGateway>('gcs'));
    regs.queue.register('cloud-tasks', lazy<QueuePorts>('cloud-tasks'));
    regs.auth.register('firebase', lazy<AuthPorts>('firebase'));
    regs.email.register('gmail', lazy<EmailSender>('gmail'));
    const config = loadConfig(PROD_ENV);
    const t0 = performance.now();
    await compose(config, regs);
    const ms = performance.now() - t0;
    console.info(`compose(production, stubbed lazy factories): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(150);
  });
});

describe('buildApp with a dependency bag', () => {
  it('works with an all-stubs bag of ports (used by integration-style tests)', async () => {
    const { ports, services } = await compose(loadConfig({ NODE_ENV: 'test' }), stubRegistries());
    const app = buildApp({ ports, services });
    const res = await app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('compose: certificate issuance wiring', () => {
  it('serves POST /api/v1/admin/certificates and rejects text overflow with the real PdfService', async () => {
    const { ports, services } = await compose(loadConfig({ NODE_ENV: 'development' }));
    expect(services.issuance).toBeDefined();
    const org = sampleOrganization();
    const event = sampleEvent({ organizationId: org.id });
    await ports.organizations.create(org);
    await ports.events.create(event);
    const dir = path.resolve(import.meta.dirname, '../fixtures/templates/good');
    const files = ['background.svg', 'fonts/main.ttf', 'assets/logo.png'];
    const reference = 'acme-devfest-attendance-v1';
    for (const file of files) {
      await ports.storage.put(
        TEMPLATES_BUCKET,
        templateKey(reference, file),
        readFileSync(path.join(dir, file)),
        {
          contentType: 'application/octet-stream',
        },
      );
    }
    const config = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    await ports.templates.create(
      sampleTemplate({
        organizationId: org.id,
        eventId: event.id,
        reference: asTemplateRef(reference),
        version: 1,
        config,
      }),
    );
    const app = buildApp({ ports, services, adminRateLimitPerMin: 100_000 });
    const headers = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
    const body = {
      organizationId: org.id,
      eventId: event.id,
      type: 'attendance',
      ownerName: 'Aysel Məmmədova',
      subject: 'Cloud workshop',
    };
    const url = '/api/v1/admin/certificates';
    const ok = await app.inject({ method: 'POST', url, headers, payload: body });
    expect(ok.statusCode).toBe(201);
    expect(await ports.certificates.count({})).toBe(1);

    const overflow = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...body, ownerName: 'a'.repeat(70) },
    });
    expect(overflow.statusCode).toBe(422);
    expect(overflow.json<{ error: { code: string } }>().error.code).toBe('TEXT_DOES_NOT_FIT');
    expect(await ports.certificates.count({})).toBe(1);
    await app.close();
  });
});
