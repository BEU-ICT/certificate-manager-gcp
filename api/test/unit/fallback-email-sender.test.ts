import { describe, expect, it } from 'vitest';
import { FallbackEmailSender } from '../../src/modules/notifications/index.js';
import {
  ConfigurationError,
  PermanentEmailError,
  QuotaExceededError,
  TransientEmailError,
  type EmailMessage,
} from '../../src/ports/index.js';
import { FakeEmailSender } from '../../src/testing/fakes/fake-email-sender.js';

const message: EmailMessage = {
  to: 'ada@example.org',
  from: 'certs@example.com',
  subject: 's',
  text: 't',
  html: 'h',
  messageId: '<cm-1-0@example.com>',
};

function setup() {
  const primary = new FakeEmailSender();
  const fallback = new FakeEmailSender();
  const logs: string[] = [];
  const logger = {
    warn: (o: Record<string, unknown>, m: string) => logs.push(JSON.stringify(o) + m),
    info: (o: Record<string, unknown>, m: string) => logs.push(JSON.stringify(o) + m),
  };
  const sender = new FallbackEmailSender(primary, fallback, logger, {
    primary: 'gmail',
    fallback: 'brevo',
  });
  return { primary, fallback, logs, sender };
}

describe('FallbackEmailSender', () => {
  it('uses the primary when it succeeds', async () => {
    const { sender, primary, fallback } = setup();
    await sender.send(message);
    expect(primary.sent).toHaveLength(1);
    expect(fallback.sent).toHaveLength(0);
  });

  it('falls back on QuotaExceededError with the same Message-ID and logs no address', async () => {
    const { sender, primary, fallback, logs } = setup();
    primary.failNext(new QuotaExceededError('quota'));
    await sender.send(message);
    expect(primary.sent).toHaveLength(0);
    expect(fallback.sent).toHaveLength(1);
    expect(fallback.sent[0]?.messageId).toBe(message.messageId);
    expect(logs.join()).toContain('brevo');
    expect(logs.join()).not.toContain('example.org');
  });

  it.each([
    new PermanentEmailError('INVALID_PARAMETER'),
    new ConfigurationError('cfg'),
    new TransientEmailError('boom'),
  ])('does not fall back on %s', async (error) => {
    const { sender, primary, fallback } = setup();
    primary.failNext(error);
    await expect(sender.send(message)).rejects.toBe(error);
    expect(fallback.sent).toHaveLength(0);
  });

  it('propagates the fallback error when both fail', async () => {
    const { sender, primary, fallback } = setup();
    const second = new TransientEmailError('fallback down');
    primary.failNext(new QuotaExceededError('quota'));
    fallback.failNext(second);
    await expect(sender.send(message)).rejects.toBe(second);
  });
});
