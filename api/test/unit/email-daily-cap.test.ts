import { describe, expect, it } from 'vitest';
import {
  DAILY_CAP_EXHAUSTED,
  createInProcessSendEmailTask,
  createSendEmailHandler,
  rescheduleTime,
} from '../../src/modules/notifications/index.js';
import { DefaultCertificateService } from '../../src/modules/certificates/index.js';
import { PermanentEmailError, TransientEmailError } from '../../src/ports/index.js';
import { emailCounterExpiry, nextUtcMidnight, utcDay } from '../../src/shared/email-quota.js';
import {
  SEND_EMAIL_HANDLER,
  emailTaskName,
  sendEmailTaskSchema,
} from '../../src/shared/email-task.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import {
  FakeEmailSender,
  FakeEmailQuotaStore,
  createFakes,
} from '../../src/testing/fakes/index.js';

const NOON = new Date('2026-11-12T12:00:00.000Z');
const DAY = '2026-11-12';

function build(
  opts: { fallback?: boolean; primaryCap?: number; fallbackCap?: number; random?: number } = {},
) {
  const fakes = createFakes();
  fakes.clock.set(NOON);
  const fallbackSender = new FakeEmailSender();
  const handle = createSendEmailHandler({
    certificates: new DefaultCertificateService(fakes.certificates, fakes.clock),
    emailSender: fakes.emailSender,
    logger: { info: () => undefined, warn: () => undefined, fatal: () => undefined },
    publicBaseUrl: 'https://certs.example.com',
    from: { address: 'certificates@example.com' },
    quota: {
      store: fakes.emailQuota,
      taskQueue: fakes.taskQueue,
      clock: fakes.clock,
      random: () => opts.random ?? 0,
      primary: { provider: 'gmail', dailyCap: opts.primaryCap ?? 1 },
      ...(opts.fallback && {
        fallback: { sender: fallbackSender, provider: 'brevo', dailyCap: opts.fallbackCap ?? 1 },
      }),
    },
  });
  const seed = async () => {
    const cert = sampleCertificate({
      email: 'a@example.com',
      emailStatus: 'pending',
      emailAttempts: 1,
    });
    await fakes.certificates.create(cert);
    return cert;
  };
  return { fakes, handle, fallbackSender, seed };
}

describe('daily cap in the send-email handler', () => {
  it('sends via the primary provider while under the cap and counts it', async () => {
    const { fakes, handle, seed } = build();
    const cert = await seed();
    expect(await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 })).toBe('done');
    expect(fakes.emailSender.sent).toHaveLength(1);
    expect(fakes.emailQuota.used('gmail', DAY)).toBe(1);
  });

  it('reschedules to next UTC midnight + 5 min + jitter when the cap is reached (no fallback)', async () => {
    const { fakes, handle, seed } = build({ random: 0.5 });
    await fakes.emailQuota.tryReserve('gmail', DAY, 1);
    const cert = await seed();
    expect(await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 })).toBe('done');
    expect(fakes.emailSender.sent).toHaveLength(0);
    expect(fakes.taskQueue.tasks).toHaveLength(1);
    const task = fakes.taskQueue.tasks[0]!;
    expect(task.name).toBe(`email-${cert.id}-1-r1`);
    expect(task.handler).toBe(SEND_EMAIL_HANDLER);
    expect(task.dedupe).toBe(true);
    expect(task.payload).toEqual({ certificateId: cert.id, sequence: 1, reschedule: 1 });
    expect(task.scheduleAt).toEqual(new Date('2026-11-13T00:20:00.000Z'));
    expect(sendEmailTaskSchema.safeParse(task.payload).success).toBe(true);
    expect((await fakes.certificates.getById(cert.id))!.emailStatus).toBe('pending');
  });

  it('names reschedules r1..r3 and marks DAILY_CAP_EXHAUSTED after the third', async () => {
    const { fakes, handle, seed } = build();
    await fakes.emailQuota.tryReserve('gmail', DAY, 1);
    const cert = await seed();
    for (const k of [0, 1, 2]) {
      await handle({ certificateId: cert.id, sequence: 1, retryCount: 0, reschedule: k });
    }
    expect(fakes.taskQueue.tasks.map((t) => t.name)).toEqual([
      `email-${cert.id}-1-r1`,
      `email-${cert.id}-1-r2`,
      `email-${cert.id}-1-r3`,
    ]);
    expect(
      await handle({ certificateId: cert.id, sequence: 1, retryCount: 0, reschedule: 3 }),
    ).toBe('done');
    expect(fakes.taskQueue.tasks).toHaveLength(3);
    const stored = (await fakes.certificates.getById(cert.id))!;
    expect(stored.emailStatus).toBe('failed');
    expect(stored.emailLastError).toBe(DAILY_CAP_EXHAUSTED);
  });

  it('sends via the fallback against its own counter and cap when the primary is full', async () => {
    const { fakes, handle, fallbackSender, seed } = build({ fallback: true });
    await fakes.emailQuota.tryReserve('gmail', DAY, 1);
    const cert = await seed();
    await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 });
    expect(fakes.emailSender.sent).toHaveLength(0);
    expect(fallbackSender.sent).toHaveLength(1);
    expect(fakes.emailQuota.used('brevo', DAY)).toBe(1);
    expect(fakes.taskQueue.tasks).toHaveLength(0);
    expect((await fakes.certificates.getById(cert.id))!.emailStatus).toBe('sent');
  });

  it('reschedules when the fallback cap is reached too', async () => {
    const { fakes, handle, fallbackSender, seed } = build({ fallback: true });
    await fakes.emailQuota.tryReserve('gmail', DAY, 1);
    await fakes.emailQuota.tryReserve('brevo', DAY, 1);
    const cert = await seed();
    await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 });
    expect(fallbackSender.sent).toHaveLength(0);
    expect(fakes.taskQueue.tasks).toHaveLength(1);
  });

  it('releases the slot after a permanent failure and after a transient one', async () => {
    const { fakes, handle, seed } = build();
    const cert = await seed();
    fakes.emailSender.failNext(new PermanentEmailError('INVALID_RECIPIENT'));
    await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 });
    expect(fakes.emailQuota.used('gmail', DAY)).toBe(0);

    const second = await seed();
    fakes.emailSender.failNext(new TransientEmailError('x'));
    expect(await handle({ certificateId: second.id, sequence: 1, retryCount: 0 })).toBe('retry');
    expect(fakes.emailQuota.used('gmail', DAY)).toBe(0);
  });

  it('keeps the slot of a delivered e-mail and does not touch the counter for skipped tasks', async () => {
    const { fakes, handle, seed } = build();
    const cert = await seed();
    await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 });
    await handle({ certificateId: cert.id, sequence: 1, retryCount: 0 }); // already sent
    expect(fakes.emailQuota.used('gmail', DAY)).toBe(1);
  });

  it('in-process task forwards the reschedule counter', async () => {
    const { fakes, handle, seed } = build();
    await fakes.emailQuota.tryReserve('gmail', DAY, 1);
    const cert = await seed();
    const task = createInProcessSendEmailTask(handle);
    await task({ certificateId: cert.id, sequence: 1, reschedule: 3 });
    expect((await fakes.certificates.getById(cert.id))!.emailLastError).toBe(DAILY_CAP_EXHAUSTED);
  });
});

describe('time helpers', () => {
  it('utcDay and nextUtcMidnight follow the UTC boundary', () => {
    expect(utcDay(new Date('2026-11-12T23:59:59.999Z'))).toBe('2026-11-12');
    expect(utcDay(new Date('2026-11-13T00:00:00.000Z'))).toBe('2026-11-13');
    expect(nextUtcMidnight(new Date('2026-11-12T23:59:59.999Z')).toISOString()).toBe(
      '2026-11-13T00:00:00.000Z',
    );
    expect(nextUtcMidnight(new Date('2026-11-13T00:00:00.000Z')).toISOString()).toBe(
      '2026-11-14T00:00:00.000Z',
    );
    expect(nextUtcMidnight(new Date('2026-12-31T10:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('rescheduleTime adds 5 minutes and jitter in [0, 30 min)', () => {
    const now = new Date('2026-11-12T23:59:00Z');
    expect(rescheduleTime(now, () => 0).toISOString()).toBe('2026-11-13T00:05:00.000Z');
    expect(rescheduleTime(now, () => 0.999999999).toISOString()).toBe('2026-11-13T00:34:59.999Z');
  });

  it('counter expiry is two days after the day ends', () => {
    expect(emailCounterExpiry('2026-11-12').toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });

  it('emailTaskName supports reschedules and rejects out-of-range ones', () => {
    expect(emailTaskName('abc', 2, 0)).toBe('email-abc-2');
    expect(emailTaskName('abc', 2, 3)).toBe('email-abc-2-r3');
    expect(() => emailTaskName('abc', 2, 4)).toThrow(RangeError);
    expect(() => emailTaskName('abc', 2, -1)).toThrow(RangeError);
    expect(
      sendEmailTaskSchema.safeParse({ certificateId: 'a', sequence: 1, reschedule: 4 }).success,
    ).toBe(false);
  });

  it('FakeEmailQuotaStore.used reads counters', async () => {
    const store = new FakeEmailQuotaStore();
    await store.tryReserve('gmail', DAY, 3);
    expect(store.used('gmail', DAY)).toBe(1);
    expect(store.used('gmail', '2026-11-13')).toBe(0);
  });
});
