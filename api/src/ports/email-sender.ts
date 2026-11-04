export interface EmailMessage {
  to: string;
  toName?: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Stable RFC 5322 Message-ID so retries do not produce duplicates. */
  messageId: string;
}

/** Retrying later may succeed (timeouts, 5xx, throttling). */
export class TransientEmailError extends Error {
  override readonly name = 'TransientEmailError';
}
/** The message will never be accepted (invalid recipient, rejected content). */
export class PermanentEmailError extends Error {
  override readonly name = 'PermanentEmailError';
}
/** The provider's sending quota is exhausted; retry after the quota resets. */
export class QuotaExceededError extends Error {
  override readonly name = 'QuotaExceededError';
}
/** Credentials or sender configuration are wrong; retrying cannot help. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

/** Error messages must not contain recipient addresses. */
export interface EmailSender {
  /**
   * Throws `TransientEmailError`, `PermanentEmailError`, `QuotaExceededError`
   * or `ConfigurationError`; never returns on failure.
   */
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}
