import type { EmailMessage, EmailSender } from '../../ports/index.js';

/**
 * Records accepted messages. Sending the same `messageId` again succeeds with the
 * same provider ID and is not recorded twice (stable Message-ID => no duplicates).
 */
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private readonly providerIds = new Map<string, string>();
  private readonly failures: Error[] = [];

  /** Makes the next `send` calls reject with these errors, one per call, in order. */
  failNext(...errors: Error[]): void {
    this.failures.push(...errors);
  }

  send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    const existing = this.providerIds.get(message.messageId);
    if (existing !== undefined) return Promise.resolve({ providerMessageId: existing });
    const providerMessageId = `fake-provider-${this.sent.length + 1}`;
    this.providerIds.set(message.messageId, providerMessageId);
    this.sent.push(structuredClone(message));
    return Promise.resolve({ providerMessageId });
  }
}
