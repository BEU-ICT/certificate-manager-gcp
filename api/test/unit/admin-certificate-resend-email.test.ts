// Routes with a happy-path test in this file (checked by test/unit/authz-matrix.test.ts):
// happy-path: POST /api/v1/admin/certificates/:id/resend-email
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- HTTP response bodies are untyped JSON; the assertions check their shape. */
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Certificate } from '../../src/shared/domain.js';
import { buildServices } from '../../src/services.js';
import { forEachAdminRoute } from '../../src/testing/admin-routes.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { createFakes, fakeToken } from '../../src/testing/fakes/index.js';
import type { TaskQueue } from '../../src/ports/index.js';

const admin = { authorization: `Bearer ${fakeToken('admin-1', 'admin')}` };
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
});

const HOUR = 3_600_000;

function setup(options: { logs?: Writable; taskQueue?: TaskQueue } = {}) {
  const fakes = createFakes();
  const ports = options.taskQueue ? { ...fakes, taskQueue: options.taskQueue } : fakes;
  app = buildApp({
    ports,
    services: buildServices(ports),
    adminRateLimitPerMin: 100_000,
    ...(options.logs && { log: { level: 'info' as const, destination: options.logs } }),
  });
  const seed = async (
    overrides: { [K in keyof Certificate]?: Certificate[K] | undefined } = {},
  ) => {
    const cert: Certificate = {
      ...sampleCertificate({
        email: 'owner@example.com',
        emailStatus: 'failed',
        emailAttempts: 1,
        emailLastError: 'REJECTED: BOUNCE',
        updatedAt: fakes.clock.now(),
      }),
    };
    // An explicit `undefined` removes the optional field.
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete (cert as unknown as Record<string, unknown>)[key];
      else (cert as unknown as Record<string, unknown>)[key] = value;
    }
    await fakes.certificates.create(cert);
    return cert;
  };
  const resend = (id: string, payload: unknown = {}, headers: Record<string, string> = admin) =>
    app!.inject({
      method: 'POST',
      url: `/api/v1/admin/certificates/${id}/resend-email`,
      headers,
      payload: payload as object,
    });
  return { fakes, seed, resend };
}

describe('POST /api/v1/admin/certificates/:id/resend-email', () => {
  it('resends a failed e-mail: 202, pending, error cleared, task with the incremented name', async () => {
    const { fakes, seed, resend } = setup();
    const cert = await seed();
    const res = await resend(cert.id);
    expect(res.statusCode).toBe(202);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ emailStatus: 'pending', emailAttempts: 2 });
    const stored = await fakes.certificates.getById(cert.id);
    expect(stored).toMatchObject({ emailStatus: 'pending', emailAttempts: 2 });
    expect(stored?.emailLastError).toBeUndefined();
    expect(fakes.taskQueue.tasks).toEqual([
      {
        name: `email-${cert.id}-2`,
        handler: '/internal/tasks/send-email',
        payload: { certificateId: cert.id, sequence: 2 },
        dedupe: true,
      },
    ]);
  });

  it('resends a sent e-mail', async () => {
    const { seed, resend } = setup();
    const cert = await seed({ emailStatus: 'sent', emailLastError: undefined });
    expect((await resend(cert.id)).statusCode).toBe(202);
  });

  it('a corrected address replaces the old one (lowercased) and is audited without addresses', async () => {
    const lines: string[] = [];
    const logs = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const { fakes, seed, resend } = setup({ logs });
    const cert = await seed();
    const res = await resend(cert.id, { email: '  New.Owner@Example.COM ' });
    expect(res.statusCode).toBe(202);
    expect((await fakes.certificates.getById(cert.id))?.email).toBe('new.owner@example.com');
    const text = lines.join('');
    const auditLine = text.split('\n').find((l) => l.includes('certificate.email_changed'));
    expect(auditLine).toBeDefined();
    expect(JSON.parse(auditLine!)).toMatchObject({
      audit: true,
      entityId: cert.id,
      adminUid: 'admin-1',
    });
    for (const address of ['owner@example.com', 'new.owner@example.com', 'New.Owner'])
      expect(text).not.toContain(address);
  });

  it('no audit line when the supplied address equals the stored one', async () => {
    const lines: string[] = [];
    const logs = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const { seed, resend } = setup({ logs });
    const cert = await seed();
    await resend(cert.id, { email: 'OWNER@example.com' });
    expect(lines.join('')).not.toContain('certificate.email_changed');
  });

  it('skipped + new address is a first send (sequence 1)', async () => {
    const { fakes, seed, resend } = setup();
    const cert = await seed({
      email: undefined,
      emailStatus: 'skipped',
      emailAttempts: 0,
      emailLastError: undefined,
    });
    const res = await resend(cert.id, { email: 'a@example.com' });
    expect(res.json()).toEqual({ emailStatus: 'pending', emailAttempts: 1 });
    expect(fakes.taskQueue.tasks.map((t) => t.name)).toEqual([`email-${cert.id}-1`]);
  });

  it('422 EMAIL_REQUIRED without any address; nothing changes', async () => {
    const { fakes, seed, resend } = setup();
    const cert = await seed({
      email: undefined,
      emailStatus: 'skipped',
      emailLastError: undefined,
    });
    const res = await resend(cert.id);
    expect([res.statusCode, res.json().error.code]).toEqual([422, 'EMAIL_REQUIRED']);
    expect(fakes.taskQueue.tasks).toHaveLength(0);
    expect((await fakes.certificates.getById(cert.id))?.emailStatus).toBe('skipped');
  });

  it('409 CERTIFICATE_REVOKED for a revoked certificate', async () => {
    const { fakes, seed, resend } = setup();
    const cert = await seed({ status: 'revoked' });
    const res = await resend(cert.id);
    expect([res.statusCode, res.json().error.code]).toEqual([409, 'CONFLICT']);
    expect(res.json().error.details[0].message).toBe('CERTIFICATE_REVOKED');
    expect(fakes.taskQueue.tasks).toHaveLength(0);
  });

  it('409 EMAIL_IN_PROGRESS while pending; a pending older than 2 hours may be resent', async () => {
    const { fakes, seed, resend } = setup();
    const cert = await seed({ emailStatus: 'pending', emailLastError: undefined });
    fakes.clock.advance(2 * HOUR - 1000);
    const busy = await resend(cert.id);
    expect([busy.statusCode, busy.json().error.details[0].message]).toEqual([
      409,
      'EMAIL_IN_PROGRESS',
    ]);
    expect(fakes.taskQueue.tasks).toHaveLength(0);
    fakes.clock.advance(2000);
    const stuck = await resend(cert.id);
    expect(stuck.statusCode).toBe(202);
    expect(stuck.json().emailAttempts).toBe(2);
  });

  it('a resend within an hour of the previous one uses a distinct task name', async () => {
    const { fakes, seed, resend } = setup();
    const cert = await seed();
    await resend(cert.id);
    await fakes.certificates.updateEmailState(cert.id, {
      emailStatus: 'failed',
      updatedAt: fakes.clock.now(),
    });
    fakes.clock.advance(10 * 60_000);
    await resend(cert.id);
    expect(fakes.taskQueue.tasks.map((t) => t.name)).toEqual([
      `email-${cert.id}-2`,
      `email-${cert.id}-3`,
    ]);
  });

  it('429 RATE_LIMITED after 5 resends in 24 hours, with Retry-After; allowed again later', async () => {
    const { fakes, seed, resend } = setup();
    const cert = await seed();
    for (let i = 0; i < 5; i += 1) {
      expect((await resend(cert.id)).statusCode).toBe(202);
      await fakes.certificates.updateEmailState(cert.id, {
        emailStatus: 'failed',
        updatedAt: fakes.clock.now(),
      });
    }
    const limited = await resend(cert.id);
    expect([limited.statusCode, limited.json().error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(fakes.taskQueue.tasks).toHaveLength(5);
    // Another certificate is unaffected.
    const other = await seed();
    expect((await resend(other.id)).statusCode).toBe(202);
    fakes.clock.advance(24 * HOUR + 1000);
    expect((await resend(cert.id)).statusCode).toBe(202);
  });

  it('enqueue failure: certificate failed / ENQUEUE_FAILED, 503, no address in the response', async () => {
    const queue: TaskQueue = { enqueue: () => Promise.reject(new Error('boom owner@example.com')) };
    const { fakes, seed, resend } = setup({ taskQueue: queue });
    const cert = await seed({ emailStatus: 'sent', emailLastError: undefined });
    const res = await resend(cert.id);
    expect([res.statusCode, res.json().error.code]).toEqual([503, 'UNAVAILABLE']);
    expect(res.body).not.toContain('owner@example.com');
    expect(await fakes.certificates.getById(cert.id)).toMatchObject({
      emailStatus: 'failed',
      emailLastError: 'ENQUEUE_FAILED',
      emailAttempts: 2,
    });
  });

  it('404 for unknown and malformed ids', async () => {
    const { resend } = setup();
    expect((await resend('z'.repeat(22))).statusCode).toBe(404);
    expect((await resend('nope')).statusCode).toBe(404);
  });

  it('400 for unknown properties and invalid addresses', async () => {
    const { seed, resend } = setup();
    const cert = await seed();
    expect((await resend(cert.id, { foo: 1 })).statusCode).toBe(400);
    expect((await resend(cert.id, { email: 'not-an-email' })).statusCode).toBe(400);
    expect((await resend(cert.id, { email: 'a'.repeat(250) + '@b.co' })).statusCode).toBe(400);
  });

  it('auth matrix: 401 without a token, 403 for a non-admin', async () => {
    const { seed, resend } = setup();
    const cert = await seed();
    const none = await resend(cert.id, {}, {});
    const user = await resend(cert.id, {}, { authorization: `Bearer ${fakeToken('u1')}` });
    expect([none.statusCode, user.statusCode]).toEqual([401, 403]);
    let seen = false;
    await forEachAdminRoute(app!, async (route) => {
      if (route.method !== 'POST' || !route.url.endsWith('/resend-email')) return;
      seen = true;
      const a = await app!.inject({ method: 'POST', url: route.concreteUrl });
      expect(a.statusCode).toBe(401);
    });
    expect(seen).toBe(true);
  });
});

describe('GET /api/v1/admin/certificates?emailStatus', () => {
  it('filters list and count by emailStatus', async () => {
    const { fakes, seed } = setup();
    await seed({ emailStatus: 'failed' });
    await seed({ emailStatus: 'sent', emailLastError: undefined });
    const get = (url: string) => app!.inject({ method: 'GET', url, headers: admin });
    const list = await get('/api/v1/admin/certificates?emailStatus=failed');
    expect(list.json().items.map((i: { emailStatus: string }) => i.emailStatus)).toEqual([
      'failed',
    ]);
    expect((await get('/api/v1/admin/certificates/count?emailStatus=sent')).json()).toEqual({
      count: 1,
    });
    expect((await get('/api/v1/admin/certificates?emailStatus=bogus')).statusCode).toBe(400);
    expect(fakes).toBeDefined();
  });
});
