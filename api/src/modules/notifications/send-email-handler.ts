import {
  ConfigurationError,
  PermanentEmailError,
  QuotaExceededError,
  TransientEmailError,
  type EmailMessage,
  type EmailSender,
} from '../../ports/index.js';
import type { Certificate } from '../../shared/domain.js';
import { NotFoundError } from '../../shared/errors.js';
import { PlainMessageComposer, type MessageComposer } from './message-composer.js';

/** `emailLastError` when the last allowed attempt failed with a retryable error. */
export const RETRIES_EXHAUSTED = 'RETRIES_EXHAUSTED';
/** Cloud Tasks `X-CloudTasks-TaskRetryCount` of the 5th (last) attempt; matches `max-attempts=5`. */
export const LAST_RETRY_COUNT = 4;

/** What notifications needs from the certificates module (satisfied by `Services.certificates`). */
export interface SendEmailCertificates {
  getPublic(id: unknown): Promise<Certificate>;
  markEmailSent(id: string): Promise<void>;
  markEmailFailed(id: string, code: string): Promise<void>;
}

/** Optional daily sending cap (BEU-ICT/certificate-manager#374). `false` means the cap is reached. */
export interface DailyCap {
  tryAcquire(): Promise<boolean>;
}

/** Minimal logger surface; satisfied by pino. Only certificate IDs and error class names are logged. */
export interface SendEmailLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  /** Cloud Logging severity CRITICAL (pino `fatal`). */
  fatal(obj: Record<string, unknown>, msg: string): void;
}

export interface SendEmailHandlerDeps {
  certificates: SendEmailCertificates;
  emailSender: EmailSender;
  logger: SendEmailLogger;
  /** `EMAIL_FROM_ADDRESS` and `EMAIL_REPLY_TO` (the display name is applied by the sender adapter). */
  from: { address: string; replyTo?: string | undefined };
  /** `PUBLIC_BASE_URL`: verification page is `<base>/c/<id>`. */
  publicBaseUrl: string;
  composer?: MessageComposer;
  /** Without a cap nothing is limited here (the provider's own quota still applies). */
  dailyCap?: DailyCap;
}

export interface SendEmailRequest {
  certificateId: string;
  sequence: number;
  /** `X-CloudTasks-TaskRetryCount`: 0 on the first attempt. */
  retryCount: number;
}

/**
 * - `done`: respond 200 (sent, failed for good, or nothing to do).
 * - `retry`: respond 500 so the queue retries (transient provider problem or cap reached).
 * - `misconfigured`: respond 500, status untouched, CRITICAL logged; a fixed configuration lets a retry succeed.
 */
export type SendEmailOutcome = 'done' | 'retry' | 'misconfigured';

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

/** Short, address-free code for `emailLastError`. */
function permanentCode(error: PermanentEmailError): string {
  const code = /^[A-Z0-9_]{1,40}$/.exec(error.message)?.[0];
  return `REJECTED: ${code ?? 'PERMANENT'}`;
}

/** Stable per (certificateId, sequence); the provider/mailbox can deduplicate a repeated send. */
export function emailMessageId(
  certificateId: string,
  sequence: number,
  fromAddress: string,
): string {
  const domain = fromAddress.slice(fromAddress.lastIndexOf('@') + 1);
  return `<cm-${certificateId}-${sequence}@${domain}>`;
}

/**
 * Handler of the send-email task (BEU-ICT/certificate-manager#368), shared by the HTTP route
 * (Cloud Tasks) and the in-process queue. Delivery is at-least-once: a crash between the provider
 * call and `markEmailSent` repeats the send; the stable Message-ID lets providers/mailboxes dedupe.
 * Status moves only `pending -> sent|failed`; `failed -> pending` happens through resend.
 */
export function createSendEmailHandler(
  deps: SendEmailHandlerDeps,
): (request: SendEmailRequest) => Promise<SendEmailOutcome> {
  const { certificates, emailSender, logger } = deps;
  const composer = deps.composer ?? new PlainMessageComposer();
  const baseUrl = deps.publicBaseUrl.replace(/\/+$/, '');

  return async ({ certificateId, sequence, retryCount }) => {
    let certificate: Certificate;
    try {
      certificate = await certificates.getPublic(certificateId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.info({ certificateId }, 'e-mail task skipped: certificate not found');
        return 'done';
      }
      throw error;
    }
    const to = certificate.email;
    if (
      certificate.status !== 'active' ||
      to === undefined ||
      sequence < certificate.emailAttempts ||
      certificate.emailStatus !== 'pending'
    ) {
      // Revoked, no address, superseded by a newer resend, or already sent/failed/skipped.
      logger.info({ certificateId, sequence }, 'e-mail task skipped: nothing to send');
      return 'done';
    }

    const exhausted = retryCount >= LAST_RETRY_COUNT;
    const retryOrFail = async (): Promise<SendEmailOutcome> => {
      if (!exhausted) return 'retry';
      await certificates.markEmailFailed(certificateId, RETRIES_EXHAUSTED);
      return 'done';
    };

    if (deps.dailyCap && !(await deps.dailyCap.tryAcquire())) {
      logger.warn({ certificateId, sequence }, 'e-mail daily cap reached');
      return retryOrFail();
    }

    const content = composer.compose(certificate, { verifyUrl: `${baseUrl}/c/${certificate.id}` });
    const message: EmailMessage = {
      to,
      toName: certificate.ownerName,
      from: deps.from.address,
      ...(deps.from.replyTo !== undefined && { replyTo: deps.from.replyTo }),
      subject: content.subject,
      text: content.text,
      html: content.html,
      messageId: emailMessageId(certificate.id, sequence, deps.from.address),
    };

    try {
      await emailSender.send(message);
    } catch (error) {
      if (error instanceof PermanentEmailError) {
        await certificates.markEmailFailed(certificateId, permanentCode(error));
        logger.warn({ certificateId, sequence }, 'e-mail rejected by the provider');
        return 'done';
      }
      if (error instanceof TransientEmailError || error instanceof QuotaExceededError) {
        logger.warn(
          { certificateId, sequence, retryCount, errorName: errorName(error) },
          'e-mail send failed, will retry',
        );
        return retryOrFail();
      }
      if (error instanceof ConfigurationError) {
        logger.fatal(
          { certificateId, sequence, errorName: errorName(error) },
          'e-mail provider configuration is invalid',
        );
        return 'misconfigured';
      }
      throw error;
    }
    await certificates.markEmailSent(certificateId);
    logger.info({ certificateId, sequence }, 'e-mail sent');
    return 'done';
  };
}
