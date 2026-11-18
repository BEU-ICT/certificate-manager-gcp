import nodemailer from 'nodemailer';
import {
  ConfigurationError,
  PermanentEmailError,
  TransientEmailError,
  type EmailMessage,
  type EmailSender,
} from '../../ports/index.js';
import { buildMessage, MessageBuildError } from '../../shared/message-builder.js';

/** Transport security: `starttls` upgrades and refuses to continue in clear text. */
export const SMTP_TLS_MODES = ['starttls', 'tls', 'none'] as const;
export type SmtpTlsMode = (typeof SMTP_TLS_MODES)[number];

export interface SmtpEmailSenderOptions {
  host: string;
  port: number;
  tls: SmtpTlsMode;
  user?: string | undefined;
  /** Secret; only handed to the transport, never logged or put into errors. */
  password?: string | undefined;
  /** Injected for tests; defaults to a pooled nodemailer transport. */
  transport?: SmtpTransport;
  now?: () => Date;
}

/** The slice of a nodemailer transport that is used. */
export interface SmtpTransport {
  sendMail(mail: {
    envelope: { from: string; to: string[] };
    raw: string;
  }): Promise<{ messageId?: string }>;
  close?(): void;
}

interface SmtpError {
  code?: unknown;
  responseCode?: unknown;
  command?: unknown;
}

/** Maps a nodemailer/SMTP failure to the port's error classes. Messages carry no addresses. */
export function mapSmtpError(error: unknown): Error {
  if (error instanceof MessageBuildError) return new PermanentEmailError('INVALID_MESSAGE');
  const { code, responseCode, command } = (error ?? {}) as SmtpError;
  const status = typeof responseCode === 'number' ? responseCode : undefined;
  const cmd = typeof command === 'string' ? command : '';

  if (code === 'EAUTH' || status === 530 || status === 534 || status === 535) {
    return new ConfigurationError(`SMTP authentication failed${status ? ` (${status})` : ''}`);
  }
  if (code === 'ETLS' || /CERT|SSL|TLS/i.test(String(code))) {
    return new ConfigurationError('SMTP TLS negotiation failed');
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new TransientEmailError(`SMTP temporary failure (${status})`);
  }
  if (status !== undefined && status >= 500) {
    if (cmd.startsWith('MAIL')) {
      return new ConfigurationError(`SMTP rejected the sender (${status})`);
    }
    if (cmd.startsWith('RCPT') || code === 'EENVELOPE') {
      return new PermanentEmailError(`SMTP_${status}`);
    }
    if (cmd === 'DATA' || cmd === 'DATA END' || cmd === '') {
      return new PermanentEmailError(`SMTP_${status}`);
    }
    return new ConfigurationError(`SMTP rejected the request (${status})`);
  }
  if (code === 'EENVELOPE') return new PermanentEmailError('SMTP_REJECTED');
  const kind = typeof code === 'string' ? code : 'unknown';
  return new TransientEmailError(`SMTP connection failed (${kind})`);
}

/**
 * SMTP sender on a pooled nodemailer transport. The MIME is built by the shared message builder
 * (same rules and Message-ID as the Gmail sender). One attempt per call; retries belong to the
 * task queue.
 */
export class SmtpEmailSender implements EmailSender {
  private readonly transport: SmtpTransport;
  private readonly now: () => Date;

  constructor(options: SmtpEmailSenderOptions) {
    this.now = options.now ?? (() => new Date());
    this.transport =
      options.transport ??
      nodemailer.createTransport({
        host: options.host,
        port: options.port,
        pool: true,
        maxConnections: 3,
        secure: options.tls === 'tls',
        requireTLS: options.tls === 'starttls',
        ignoreTLS: options.tls === 'none',
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        ...(options.user ? { auth: { user: options.user, pass: options.password ?? '' } } : {}),
      });
  }

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    try {
      const raw = buildMessage(message, { date: this.now() });
      await this.transport.sendMail({
        envelope: { from: message.from, to: [message.to] },
        raw,
      });
      return { providerMessageId: message.messageId };
    } catch (error) {
      throw mapSmtpError(error);
    }
  }

  close(): void {
    this.transport.close?.();
  }
}
