import { describe, expect, it } from 'vitest';
import { DefaultCertificateService } from '../../src/modules/certificates/index.js';
import {
  ENQUEUE_FAILED,
  registerIssuedEmailSubscriber,
} from '../../src/modules/notifications/index.js';
import { TransientQueueError, type TaskQueue } from '../../src/ports/index.js';
import { SEND_EMAIL_HANDLER } from '../../src/shared/email-task.js';
import { NotFoundError } from '../../src/shared/errors.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { FakeClock } from '../../src/testing/fakes/fake-clock.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import type { Certificate } from '../../src/shared/domain.js';

function setup(queue?: TaskQueue) {
  const fakes = createFakes();
  const clock = new FakeClock();
  const certificates = new DefaultCertificateService(fakes.certificates, clock);
  const errors: { obj: Record<string, unknown>; msg: string }[] = [];
  registerIssuedEmailSubscriber(fakes.eventBus, {
    certificates,
    taskQueue: queue ?? fakes.taskQueue,
    logger: { error: (obj, msg) => errors.push({ obj, msg }) },
  });
  const issue = async (overrides: Partial<Certificate> = {}) => {
    const cert = sampleCertificate({
      email: 'secret@example.com',
      emailStatus: 'pending',
      ...overrides,
    });
    await fakes.certificates.create(cert);
    return cert;
  };
  const publish = (c: Certificate, hasEmail = c.email !== undefined) =>
    fakes.eventBus.publish('certificate.issued', {
      certificateId: c.id,
      organizationId: c.organizationId,
      eventId: c.eventId,
      hasEmail,
      occurredAt: new Date(),
    });
  return { fakes, certificates, errors, issue, publish };
}

describe('certificate.issued e-mail subscriber', () => {
  it('enqueues one task with the expected name and an identifier-only payload', async () => {
    const { fakes, issue, publish } = setup();
    const cert = await issue();
    await publish(cert);
    expect(fakes.taskQueue.tasks).toEqual([
      {
        name: `email-${cert.id}-1`,
        handler: SEND_EMAIL_HANDLER,
        payload: { certificateId: cert.id, sequence: 1 },
        dedupe: true,
      },
    ]);
    expect((await fakes.certificates.getById(cert.id))?.emailAttempts).toBe(1);
  });

  it('never enqueues without an e-mail address', async () => {
    const { fakes, issue, publish } = setup();
    const cert = await issue({ emailStatus: 'skipped' });
    delete cert.email;
    await publish(cert, false);
    expect(fakes.taskQueue.tasks).toHaveLength(0);
    expect((await fakes.certificates.getById(cert.id))?.emailAttempts).toBe(0);
  });

  it('marks the certificate failed when the queue refuses the task, without throwing', async () => {
    const failing: TaskQueue = {
      enqueue: () => Promise.reject(new TransientQueueError('queue down: secret@example.com')),
    };
    const { fakes, issue, publish, errors } = setup(failing);
    const cert = await issue();
    await publish(cert);
    const stored = await fakes.certificates.getById(cert.id);
    expect(stored?.emailStatus).toBe('failed');
    expect(stored?.emailLastError).toBe(ENQUEUE_FAILED);
    expect(fakes.eventBus.errors).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj).toEqual({ certificateId: cert.id, errorName: 'TransientQueueError' });
    expect(JSON.stringify(errors)).not.toContain('secret@example.com');
  });

  it('logs and swallows a failing reservation (unknown certificate)', async () => {
    const { fakes, publish, errors } = setup();
    const cert = sampleCertificate({ email: 'a@example.com', emailStatus: 'pending' });
    await publish(cert);
    expect(fakes.taskQueue.tasks).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj['certificateId']).toBe(cert.id);
  });

  it('yields one task when the event is delivered twice', async () => {
    const { fakes, issue, publish } = setup();
    const cert = await issue();
    await publish(cert);
    await publish(cert);
    expect(fakes.taskQueue.tasks.map((t) => t.name)).toEqual([`email-${cert.id}-1`]);
    expect((await fakes.certificates.getById(cert.id))?.emailAttempts).toBe(1);
  });

  it('creates 500 tasks for 500 bulk events', async () => {
    const { fakes, issue, publish } = setup();
    const certs: Certificate[] = [];
    for (let i = 0; i < 500; i += 1) certs.push(await issue());
    await Promise.all(certs.map((c) => publish(c)));
    expect(fakes.taskQueue.tasks).toHaveLength(500);
    expect(new Set(fakes.taskQueue.tasks.map((t) => t.name)).size).toBe(500);
  });
});

describe('CertificateService e-mail reservation', () => {
  it('reserveEmailSend: first send 1, duplicate null, resend increments', async () => {
    const { certificates, issue } = setup();
    const cert = await issue();
    expect(await certificates.reserveEmailSend(cert.id)).toBe(1);
    expect(await certificates.reserveEmailSend(cert.id)).toBeNull();
    expect(await certificates.reserveEmailSend(cert.id, { resend: true })).toBe(2);
  });

  it('rejects unknown and malformed IDs with NotFoundError', async () => {
    const { certificates } = setup();
    await expect(certificates.reserveEmailSend('x'.repeat(22))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(certificates.reserveEmailSend('bad id')).rejects.toBeInstanceOf(NotFoundError);
    await expect(certificates.markEmailFailed('x'.repeat(22), 'E')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
