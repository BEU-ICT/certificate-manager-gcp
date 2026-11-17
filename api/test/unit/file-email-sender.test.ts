import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createEmailSender, looksLocal } from '../../src/adapters/file/index.js';
import { FileEmailSender, renderEml } from '../../src/adapters/file/file-email-sender.js';
import { AdapterError, compose, defaultRegistries } from '../../src/compose.js';
import { buildServices } from '../../src/services.js';
import { loadConfig } from '../../src/config.js';
import { PermanentEmailError, type EmailMessage } from '../../src/ports/index.js';
import {
  sampleEvent,
  sampleOrganization,
  sampleTemplate,
} from '../../src/testing/contracts/index.js';
import { fakeToken } from '../../src/testing/fakes/index.js';

const message: EmailMessage = {
  to: 'owner@example.com',
  toName: 'Aysel Məmmədova',
  from: 'certificates@example.com',
  replyTo: 'help@example.com',
  subject: 'Sertifikatınız / Your certificate',
  text: 'Hello text',
  html: '<p>Hello <b>html</b></p>',
  messageId: '<cm-abc-1@example.com>',
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cm-mail-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const decode = (eml: string, type: string): string => {
  const re = new RegExp(
    `Content-Type: ${type}; charset=utf-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([^-]*)`,
  );
  const body = re.exec(eml)?.[1] ?? '';
  return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
};

describe('FileEmailSender', () => {
  it('writes an .eml with headers and both parts, and logs a one-line summary without addresses', async () => {
    const lines: string[] = [];
    const sender = new FileEmailSender({
      dir: path.join(dir, 'nested'),
      log: (l) => lines.push(l),
      now: () => new Date('2026-11-17T10:00:00.123Z'),
    });
    const { providerMessageId } = await sender.send(message);
    const files = await readdir(path.join(dir, 'nested'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^20261117T100000123Z-.+\.eml$/);
    expect(providerMessageId).toMatch(/^file-/);
    const eml = await readFile(path.join(dir, 'nested', files[0] as string), 'utf8');
    expect(eml).toContain('Message-ID: <cm-abc-1@example.com>');
    expect(eml).toContain('From: certificates@example.com');
    expect(eml).toContain('To: =?UTF-8?B?');
    expect(eml).toContain('<owner@example.com>');
    expect(eml).toContain('Reply-To: help@example.com');
    expect(eml).toContain('Subject: =?UTF-8?B?');
    expect(decode(eml, 'text/plain')).toBe('Hello text');
    expect(decode(eml, 'text/html')).toBe('<p>Hello <b>html</b></p>');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('example.com');
    expect(lines[0]).not.toContain('Aysel');
  });

  it('does not write twice for the same Message-ID and returns the same provider id', async () => {
    const sender = new FileEmailSender({ dir });
    const a = await sender.send(message);
    const b = await sender.send(message);
    expect(b).toEqual(a);
    expect(await readdir(dir)).toHaveLength(1);
    await sender.send({ ...message, messageId: '<cm-abc-2@example.com>' });
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('strips header injection from addresses and subjects', () => {
    const rest: EmailMessage = { ...message };
    delete rest.toName;
    const eml = renderEml(
      { ...rest, to: 'a@b.c\r\nBcc: x@y.z', subject: 'hi\r\nBcc: x@y.z' },
      new Date(0),
    );
    expect(eml).not.toMatch(/^Bcc:/m);
  });

  it('maps write failures to a permanent error without paths or addresses', async () => {
    const blocker = path.join(dir, 'file');
    await writeFile(blocker, 'x');
    const sender = new FileEmailSender({ dir: path.join(blocker, 'sub') });
    const err = await sender.send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentEmailError);
    expect((err as Error).message).toBe('FILE_SINK_WRITE_FAILED');
  });
});

describe('config and registration', () => {
  const local = { NODE_ENV: 'development', EMAIL_PROVIDER: 'file' };

  it('accepts file as provider, with the default directory', () => {
    expect(loadConfig(local).email).toMatchObject({
      provider: 'file',
      fileDir: '.local-data/mail',
    });
    expect(loadConfig({ ...local, EMAIL_FILE_DIR: '/tmp/m' }).email.fileDir).toBe('/tmp/m');
  });

  it('refuses file in production config (provider and fallback)', () => {
    const prod = {
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
      EMAIL_FROM_ADDRESS: 'c@example.com',
      DB_ADAPTER: 'firestore',
      STORAGE_ADAPTER: 'gcs',
      QUEUE_ADAPTER: 'cloud-tasks',
      AUTH_PROVIDER: 'firebase',
    };
    expect(() => loadConfig({ ...prod, EMAIL_PROVIDER: 'file' })).toThrow(/EMAIL_PROVIDER/);
    expect(() =>
      loadConfig({ ...prod, EMAIL_PROVIDER: 'gmail', EMAIL_FALLBACK_PROVIDER: 'file' }),
    ).toThrow(/EMAIL_FALLBACK_PROVIDER/);
  });

  it('the adapter factory refuses configs that look deployed', () => {
    expect(looksLocal(loadConfig(local))).toBe(true);
    for (const env of [
      { ...local, GCP_PROJECT: 'real-project' },
      { ...local, PUBLIC_BASE_URL: 'https://certs.example.org' },
      { ...local, SERVICE_URL: 'https://api.example.org' },
    ]) {
      expect(() => createEmailSender({ config: loadConfig(env) })).toThrow(AdapterError);
    }
    expect(
      createEmailSender({ config: loadConfig({ ...local, LOG_LEVEL: 'silent' }) }),
    ).toBeInstanceOf(FileEmailSender);
  });

  it('is registered in the default registries', async () => {
    const sender = await defaultRegistries().email.resolve('file', {
      config: loadConfig({ ...local, LOG_LEVEL: 'silent', EMAIL_FILE_DIR: dir }),
    });
    expect(sender).toBeInstanceOf(FileEmailSender);
  });
});

describe('local flow: issue and resend write .eml files', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('issuing a certificate and resending it each produce a file', async () => {
    const config = loadConfig({
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'file',
      EMAIL_FILE_DIR: dir,
      LOG_LEVEL: 'silent',
    });
    const { ports } = await compose(config);
    // Same ports (and event bus) as the composition; only the PDF fit check is stubbed out.
    const services = buildServices(ports, undefined, {
      fitChecker: { checkFit: () => Promise.resolve({ fits: true, issues: [] }) },
    });
    const org = sampleOrganization();
    const event = sampleEvent({ organizationId: org.id });
    await ports.organizations.create(org);
    await ports.events.create(event);
    await ports.templates.create(
      sampleTemplate({ organizationId: org.id, eventId: event.id, version: 1 }),
    );
    app = buildApp({ ports, services, adminRateLimitPerMin: 100_000 });
    const headers = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };

    const issued = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/certificates',
      headers,
      payload: {
        organizationId: org.id,
        eventId: event.id,
        type: 'attendance',
        ownerName: 'Aysel Məmmədova',
        subject: 'Cloud workshop',
        email: 'owner@example.com',
      },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    const id = issued.json<{ id: string }>().id;
    await waitForFiles(dir, 1);

    const resent = await resend(app, id, headers);
    expect(resent.statusCode).toBe(202);
    await waitForFiles(dir, 2);
    const files = await readdir(dir);
    expect(files.every((f) => f.endsWith('.eml'))).toBe(true);
    expect(files.join()).toContain(`${id}-1`);
    expect(files.join()).toContain(`${id}-2`);
  });
});

function resend(app: FastifyInstance, id: string, headers: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/admin/certificates/${id}/resend-email`,
    headers,
    payload: {},
  });
}

async function waitForFiles(dir: string, count: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await readdir(dir).catch(() => [])).length >= count) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`expected ${count} file(s) in ${dir}`);
}
