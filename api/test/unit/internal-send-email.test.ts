import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import {
  createInProcessSendEmailTask,
  createSendEmailHandler,
} from '../../src/modules/notifications/index.js';
import {
  ConfigurationError,
  PermanentEmailError,
  QuotaExceededError,
  TransientEmailError,
} from '../../src/ports/index.js';
import { DefaultCertificateService } from '../../src/modules/certificates/index.js';
import { SEND_EMAIL_HANDLER } from '../../src/shared/email-task.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import { TEST_TASK_CREDENTIAL } from '../../src/testing/fakes/fake-verifiers.js';
import type { Certificate } from '../../src/shared/domain.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});

function setup() {
  const fakes = createFakes();
  app = buildApp({ ports: fakes });
  const seed = async (overrides: Partial<Certificate> = {}, withoutEmail = false) => {
    const cert = sampleCertificate({
      email: 'secret@example.com',
      emailStatus: 'pending',
      emailAttempts: 1,
      ...overrides,
    });
    if (withoutEmail) delete cert.email;
    await fakes.certificates.create(cert);
    return cert;
  };
  const post = (
    body: unknown,
    headers: Record<string, string> = { authorization: TEST_TASK_CREDENTIAL },
  ) =>
    app!.inject({
      method: 'POST',
      url: SEND_EMAIL_HANDLER,
      headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(body),
    });
  const stored = async (c: Certificate) => (await fakes.certificates.getById(c.id))!;
  return { fakes, seed, post, stored };
}

describe('POST /internal/tasks/send-email', () => {
  it('sends, marks sent and answers 200 with an empty body', async () => {
    const { fakes, seed, post, stored } = setup();
    const cert = await seed({ emailLastError: 'OLD' });
    const res = await post({ certificateId: cert.id, sequence: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(fakes.emailSender.sent).toHaveLength(1);
    const message = fakes.emailSender.sent[0]!;
    expect(message.to).toBe('secret@example.com');
    expect(message.messageId).toBe(`<cm-${cert.id}-1@example.com>`);
    expect(message.text).toContain(`/c/${cert.id}`);
    const after = await stored(cert);
    expect(after.emailStatus).toBe('sent');
    expect(after.emailSentAt).toBeInstanceOf(Date);
    expect(after.emailLastError).toBeUndefined();
  });

  it('uses the same Message-ID for a repeated delivery of the same task', async () => {
    const { fakes, seed, post } = setup();
    const cert = await seed();
    await post({ certificateId: cert.id, sequence: 1 });
    expect(fakes.emailSender.sent[0]!.messageId).toBe(`<cm-${cert.id}-1@example.com>`);
  });

  it('marks a permanent failure as failed and answers 200', async () => {
    const { fakes, seed, post, stored } = setup();
    const cert = await seed();
    fakes.emailSender.failNext(new PermanentEmailError('INVALID_RECIPIENT'));
    const res = await post({ certificateId: cert.id, sequence: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    const after = await stored(cert);
    expect(after.emailStatus).toBe('failed');
    expect(after.emailLastError).toBe('REJECTED: INVALID_RECIPIENT');
  });

  it('never copies a provider message into emailLastError', async () => {
    const { fakes, seed, post, stored } = setup();
    const cert = await seed();
    fakes.emailSender.failNext(new PermanentEmailError('bad address secret@example.com'));
    await post({ certificateId: cert.id, sequence: 1 });
    expect((await stored(cert)).emailLastError).toBe('REJECTED: PERMANENT');
  });

  it.each([new TransientEmailError('x'), new QuotaExceededError('x')])(
    'answers 500 for %s and keeps the status pending',
    async (error) => {
      const { fakes, seed, post, stored } = setup();
      const cert = await seed();
      fakes.emailSender.failNext(error);
      const res = await post(
        { certificateId: cert.id, sequence: 1 },
        { authorization: TEST_TASK_CREDENTIAL, 'x-cloudtasks-taskretrycount': '3' },
      );
      expect(res.statusCode).toBe(500);
      expect(res.body).toBe('');
      expect((await stored(cert)).emailStatus).toBe('pending');
    },
  );

  it('marks RETRIES_EXHAUSTED on the 5th attempt (retry count 4) and answers 200', async () => {
    const { fakes, seed, post, stored } = setup();
    const cert = await seed();
    fakes.emailSender.failNext(new TransientEmailError('x'));
    const res = await post(
      { certificateId: cert.id, sequence: 1 },
      { authorization: TEST_TASK_CREDENTIAL, 'x-cloudtasks-taskretrycount': '4' },
    );
    expect(res.statusCode).toBe(200);
    const after = await stored(cert);
    expect(after.emailStatus).toBe('failed');
    expect(after.emailLastError).toBe('RETRIES_EXHAUSTED');
  });

  it('answers 500 and leaves the status alone on a configuration error, even on the last attempt', async () => {
    const { fakes, seed, post, stored } = setup();
    const cert = await seed();
    fakes.emailSender.failNext(new ConfigurationError('x'));
    const res = await post(
      { certificateId: cert.id, sequence: 1 },
      { authorization: TEST_TASK_CREDENTIAL, 'x-cloudtasks-taskretrycount': '4' },
    );
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('');
    expect((await stored(cert)).emailStatus).toBe('pending');
  });

  it.each([
    ['revoked', { status: 'revoked' as const }],
    ['without e-mail', { emailStatus: 'skipped' as const }],
    ['superseded by a resend', { emailAttempts: 2 }],
    ['already sent', { emailStatus: 'sent' as const }],
    ['already failed', { emailStatus: 'failed' as const }],
  ])('is a 200 no-op for a certificate %s', async (name, overrides) => {
    const { fakes, seed, post, stored } = setup();
    const cert = await seed(overrides, name === 'without e-mail');
    const before = await stored(cert);
    const res = await post({ certificateId: cert.id, sequence: 1 });
    expect(res.statusCode).toBe(200);
    expect(fakes.emailSender.sent).toHaveLength(0);
    expect(await stored(cert)).toEqual(before);
  });

  it('is a 200 no-op for a missing or malformed certificate ID', async () => {
    const { fakes, post } = setup();
    expect((await post({ certificateId: 'unknown-id-aaaaaaaaaaa', sequence: 1 })).statusCode).toBe(
      200,
    );
    expect((await post({ certificateId: '!!', sequence: 1 })).statusCode).toBe(200);
    expect(fakes.emailSender.sent).toHaveLength(0);
  });

  it('sends a resend with the newer sequence while the older task is a no-op', async () => {
    const { fakes, seed, post } = setup();
    const cert = await seed({ emailAttempts: 2 });
    expect((await post({ certificateId: cert.id, sequence: 1 })).statusCode).toBe(200);
    expect(fakes.emailSender.sent).toHaveLength(0);
    expect((await post({ certificateId: cert.id, sequence: 2 })).statusCode).toBe(200);
    expect(fakes.emailSender.sent[0]!.messageId).toBe(`<cm-${cert.id}-2@example.com>`);
  });

  describe('authentication (before any database access)', () => {
    it.each([
      ['no header', {}],
      ['wrong token', { authorization: 'Bearer nope' }],
      ['other scheme', { authorization: 'Basic abc' }],
    ])('answers 401 with an empty body: %s', async (_name, headers) => {
      const { fakes, seed, post } = setup();
      const cert = await seed();
      const reads = { count: 0 };
      const original = fakes.certificates.getById.bind(fakes.certificates);
      fakes.certificates.getById = (id) => {
        reads.count += 1;
        return original(id);
      };
      const res = await post({ certificateId: cert.id, sequence: 1 }, headers);
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('');
      expect(reads.count).toBe(0);
      expect(fakes.emailSender.sent).toHaveLength(0);
    });

    it('rejects an invalid body only after authentication', async () => {
      const { post } = setup();
      expect((await post({ nope: 1 }, {})).statusCode).toBe(401);
    });
  });

  describe('body validation', () => {
    it.each([
      [{ certificateId: 'abc', sequence: 1, extra: true }],
      [{ certificateId: 'abc' }],
      [{ certificateId: 'abc', sequence: 0 }],
      [{ certificateId: 'abc', sequence: 'x' }],
    ])('answers 400 for %j', async (body) => {
      const { fakes, post } = setup();
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(fakes.emailSender.sent).toHaveLength(0);
    });
  });

  it('is not part of the OpenAPI document and not under /api/v1', async () => {
    setup();
    const a = buildApp({ ports: createFakes(), openApiEndpoint: true });
    const res = await a.inject({ method: 'GET', url: '/internal/openapi.json' });
    await a.close();
    expect(JSON.stringify(res.json())).not.toContain('/internal/tasks/send-email');
  });

  it('has its own limiter: floods get 429, other routes are unaffected', async () => {
    const fakes = createFakes();
    app = buildApp({ ports: fakes });
    const bad = () =>
      app!.inject({ method: 'POST', url: SEND_EMAIL_HANDLER, payload: {}, headers: {} });
    let last = 0;
    for (let i = 0; i < 601; i += 1) last = (await bad()).statusCode;
    expect(last).toBe(429);
    const health = await app.inject({ method: 'GET', url: '/internal/healthz' });
    expect(health.statusCode).toBe(200);
  });
});

describe('daily cap and in-process task', () => {
  const build = () => {
    const fakes = createFakes();
    const logs: string[] = [];
    const handle = createSendEmailHandler({
      certificates: new DefaultCertificateService(fakes.certificates, fakes.clock),
      emailSender: fakes.emailSender,
      logger: {
        info: (_o, m) => logs.push(m),
        warn: (_o, m) => logs.push(m),
        fatal: (_o, m) => logs.push(m),
      },
      publicBaseUrl: 'https://certs.example.com/',
      from: { address: 'certificates@example.com', replyTo: 'reply@example.com' },
    });
    return { fakes, handle, logs };
  };

  it('builds the link from the base URL and passes reply-to; logs carry no address or name', async () => {
    const { fakes, handle, logs } = build();
    const cert = sampleCertificate({
      email: 'secret@example.com',
      ownerName: 'Secret <b>Name</b>',
      emailStatus: 'pending',
      emailAttempts: 1,
    });
    await fakes.certificates.create(cert);
    await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 });
    const message = fakes.emailSender.sent[0]!;
    expect(message.text).toContain(`https://certs.example.com/c/${cert.id}`);
    expect(message.replyTo).toBe('reply@example.com');
    expect(message.html).not.toContain('<b>');
    expect(logs.join(' ')).not.toMatch(/secret@|Secret/);
  });

  it('in-process task: throws to retry, counts attempts, fails on the 5th, ignores bad payloads', async () => {
    const { fakes, handle } = build();
    const task = createInProcessSendEmailTask(handle);
    const cert = sampleCertificate({
      email: 'a@example.com',
      emailStatus: 'pending',
      emailAttempts: 1,
    });
    await fakes.certificates.create(cert);
    await expect(task({ nope: true })).resolves.toBeUndefined();
    const payload = { certificateId: cert.id, sequence: 1 };
    for (let i = 0; i < 4; i += 1) {
      fakes.emailSender.failNext(new TransientEmailError('x'));
      await expect(task(payload)).rejects.toThrow();
    }
    fakes.emailSender.failNext(new TransientEmailError('x'));
    await expect(task(payload)).resolves.toBeUndefined();
    expect((await fakes.certificates.getById(cert.id))!.emailLastError).toBe('RETRIES_EXHAUSTED');
  });

  it('in-process task sends successfully', async () => {
    const { fakes, handle } = build();
    const task = createInProcessSendEmailTask(handle);
    const cert = sampleCertificate({
      email: 'a@example.com',
      emailStatus: 'pending',
      emailAttempts: 1,
    });
    await fakes.certificates.create(cert);
    await task({ certificateId: cert.id, sequence: 1 });
    expect((await fakes.certificates.getById(cert.id))!.emailStatus).toBe('sent');
  });
});
