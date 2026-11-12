import {
  ConfigurationError,
  PermanentEmailError,
  QuotaExceededError,
  TransientEmailError,
  type EmailMessage,
  type EmailSender,
} from '../../ports/index.js';

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
export const BREVO_TIMEOUT_MS = 10_000;

export interface BrevoEmailSenderOptions {
  /** `EMAIL_API_KEY`; sent only in the `api-key` header, never logged or put into errors. */
  apiKey: string;
  /** Display name of the sender (`EMAIL_FROM_NAME`). */
  fromName?: string | undefined;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Maps the Brevo error `code` to a short, address-free token (the handler stores it as `REJECTED: <code>`). */
function rejectionCode(body: unknown): string {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return 'PERMANENT';
  const token = code
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 40);
  return token || 'PERMANENT';
}

/** True when a 400 body points at the recipient address (not sender, payload or unknown causes). */
function concernsRecipient(body: unknown): boolean {
  const { code, message } = (body ?? {}) as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || code.toLowerCase() !== 'invalid_parameter') return false;
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  if (/sender|reply|header|subject|content/.test(text)) return false;
  return /\bto\b|recipient|email|address/.test(text);
}

/**
 * Brevo transactional API (`POST /v3/smtp/email`) over the global `fetch`. One attempt per call:
 * retries belong to the task queue. Error messages never contain addresses or the API key.
 */
export class BrevoEmailSender implements EmailSender {
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: BrevoEmailSenderOptions) {
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? BREVO_TIMEOUT_MS;
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const payload = {
      sender: {
        email: message.from,
        ...(this.options.fromName ? { name: this.options.fromName } : {}),
      },
      to: [{ email: message.to, ...(message.toName ? { name: message.toName } : {}) }],
      ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
      headers: { 'Message-ID': message.messageId, 'Auto-Submitted': 'auto-generated' },
    };
    let response: Response;
    try {
      response = await this.doFetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.options.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // Timeout, DNS or connection failure; the cause may embed the URL, so only its class is kept.
      const kind = error instanceof Error ? error.name : 'unknown';
      throw new TransientEmailError(`Brevo request failed (${kind})`);
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { messageId?: unknown } | null;
      const id = body?.messageId;
      if (typeof id !== 'string' || id === '') {
        throw new TransientEmailError('Brevo accepted the request without a messageId');
      }
      return { providerMessageId: id };
    }

    const status = response.status;
    // Always consume the body so the connection is released.
    const raw = await response.text().catch(() => '');
    if (status === 400) {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      if (concernsRecipient(body)) throw new PermanentEmailError(rejectionCode(body));
      // Sender/domain, missing parameter, payload size or unknown: not the recipient's fault.
      throw new ConfigurationError('Brevo rejected the request (HTTP 400)');
    }
    if (status === 401 || status === 403) {
      throw new ConfigurationError(`Brevo rejected the credentials (HTTP ${status})`);
    }
    if (status === 429)
      throw new QuotaExceededError('Brevo rate or quota limit reached (HTTP 429)');
    throw new TransientEmailError(`Brevo request failed (HTTP ${status})`);
  }
}
