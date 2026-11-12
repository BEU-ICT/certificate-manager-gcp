import {
  ConfigurationError,
  PermanentEmailError,
  QuotaExceededError,
  TransientEmailError,
  type Clock,
  type EmailMessage,
  type EmailQuotaStore,
  type EmailSender,
  type TaskQueue,
} from '../../ports/index.js';
import type { Certificate } from '../../shared/domain.js';
import { nextUtcMidnight, utcDay } from '../../shared/email-quota.js';
import { MAX_RESCHEDULES, SEND_EMAIL_HANDLER, emailTaskName } from '../../shared/email-task.js';
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

/** `emailLastError` when the daily cap stayed reached through every allowed reschedule. */
export const DAILY_CAP_EXHAUSTED = 'DAILY_CAP_EXHAUSTED';
/** A rescheduled task runs this long after the next UTC midnight, plus jitter. */
export const RESCHEDULE_DELAY_MS = 5 * 60 * 1000;
/** Upper bound (exclusive) of the random jitter added to the rescheduled time. */
export const RESCHEDULE_JITTER_MS = 30 * 60 * 1000;

/**
 * When a task that hit the cap at `now` runs again: next UTC midnight + 5 min + jitter in
 * [0, 30 min). `random` returns a number in [0, 1).
 */
export function rescheduleTime(now: Date, random: () => number): Date {
  const jitter = Math.min(RESCHEDULE_JITTER_MS - 1, Math.floor(random() * RESCHEDULE_JITTER_MS));
  return new Date(nextUtcMidnight(now).getTime() + RESCHEDULE_DELAY_MS + Math.max(0, jitter));
}

/**
 * Daily sending caps (BEU-ICT/certificate-manager#374). Without this the handler sends without a
 * cap here (the provider's own quota still applies).
 */
export interface DailyQuotaDeps {
  store: EmailQuotaStore;
  /** Receives the rescheduled task. */
  taskQueue: TaskQueue;
  clock: Clock;
  /** In [0, 1); injected for tests. Defaults to `Math.random`. */
  random?: () => number;
  /** Counter name (the configured provider, e.g. `gmail`) and `EMAIL_DAILY_CAP`. */
  primary: { provider: string; dailyCap: number };
  /** Only when `Ports.emailFallback` exists: its own counter and `EMAIL_FALLBACK_DAILY_CAP`. */
  fallback?: { sender: EmailSender; provider: string; dailyCap: number };
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
  quota?: DailyQuotaDeps;
}

export interface SendEmailRequest {
  certificateId: string;
  sequence: number;
  /** `X-CloudTasks-TaskRetryCount`: 0 on the first attempt. */
  retryCount: number;
  /** Daily-cap reschedules so far (task name suffix `-r<k>`); 0 or omitted for the original task. */
  reschedule?: number | undefined;
}

/**
 * - `done`: respond 200 (sent, failed for good, or nothing to do).
 * - `retry`: respond 500 so the queue retries (transient provider problem).
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

  const quota = deps.quota;
  const random = quota?.random ?? Math.random;

  return async ({ certificateId, sequence, retryCount, reschedule = 0 }) => {
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

    // Reserve one slot of today's primary counter, else of the fallback's, else reschedule.
    let sender = emailSender;
    let reserved: { provider: string; day: string } | undefined;
    if (quota) {
      const now = quota.clock.now();
      const day = utcDay(now);
      const { provider, dailyCap } = quota.primary;
      if ((await quota.store.tryReserve(provider, day, dailyCap)).granted) {
        reserved = { provider, day };
      } else if (
        quota.fallback &&
        (await quota.store.tryReserve(quota.fallback.provider, day, quota.fallback.dailyCap))
          .granted
      ) {
        logger.warn({ certificateId, sequence }, 'e-mail daily cap reached, using the fallback');
        sender = quota.fallback.sender;
        reserved = { provider: quota.fallback.provider, day };
      } else {
        logger.warn({ certificateId, sequence, reschedule }, 'e-mail daily cap reached');
        if (reschedule >= MAX_RESCHEDULES) {
          await certificates.markEmailFailed(certificateId, DAILY_CAP_EXHAUSTED);
          return 'done';
        }
        const next = reschedule + 1;
        await quota.taskQueue.enqueue({
          name: emailTaskName(certificateId, sequence, next),
          handler: SEND_EMAIL_HANDLER,
          payload: { certificateId, sequence, reschedule: next },
          scheduleAt: rescheduleTime(now, random),
          dedupe: true,
        });
        return 'done';
      }
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

    let delivered = false;
    try {
      await sender.send(message);
      delivered = true;
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
    } finally {
      // A reserved slot that was never delivered goes back (a retry reserves again).
      if (!delivered && quota && reserved) {
        try {
          await quota.store.release(reserved.provider, reserved.day);
        } catch (error) {
          logger.warn(
            { certificateId, sequence, errorName: errorName(error) },
            'e-mail quota slot could not be released',
          );
        }
      }
    }
    await certificates.markEmailSent(certificateId);
    logger.info({ certificateId, sequence }, 'e-mail sent');
    return 'done';
  };
}
