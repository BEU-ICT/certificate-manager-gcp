import { QuotaExceededError, type EmailMessage, type EmailSender } from '../../ports/index.js';

/** Minimal logger surface (pino). Only provider names are logged, never addresses. */
export interface FallbackLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Sends through `primary`; when it reports `QuotaExceededError` the same message (same Message-ID)
 * goes through `fallback`. Permanent, configuration and transient errors are not retried on the
 * fallback (a bad address stays bad; transient errors are retried by the queue). If the fallback
 * fails too, its error propagates. The daily cap is handled by the send-email handler, which
 * addresses the fallback sender directly.
 */
export class FallbackEmailSender implements EmailSender {
  constructor(
    private readonly primary: EmailSender,
    private readonly fallback: EmailSender,
    private readonly logger: FallbackLogger,
    private readonly names: { primary: string; fallback: string } = {
      primary: 'primary',
      fallback: 'fallback',
    },
  ) {}

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    try {
      return await this.primary.send(message);
    } catch (error) {
      if (!(error instanceof QuotaExceededError)) throw error;
      this.logger.warn(
        { provider: this.names.primary, fallbackProvider: this.names.fallback },
        'e-mail provider quota exceeded, using the fallback provider',
      );
    }
    const result = await this.fallback.send(message);
    this.logger.info(
      { provider: this.names.fallback },
      'e-mail sent through the fallback provider',
    );
    return result;
  }
}
