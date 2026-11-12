import type { Clock, PrepareEmailResendResult, RateLimiter, TaskQueue } from '../../ports/index.js';
import {
  SEND_EMAIL_HANDLER,
  emailTaskName,
  type SendEmailTaskPayload,
} from '../../shared/email-task.js';
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  UnavailableError,
  UnprocessableError,
} from '../../shared/errors.js';
import { parseCertificateId } from '../../shared/ids.js';
import { ENQUEUE_FAILED, type NotificationsLogger } from './issued-email-subscriber.js';

export const CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED';
export const EMAIL_REQUIRED = 'EMAIL_REQUIRED';
export const EMAIL_IN_PROGRESS = 'EMAIL_IN_PROGRESS';
/** Resends allowed per certificate within {@link RESEND_WINDOW_MS}. */
export const RESEND_LIMIT = 5;
export const RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;
/** `Retry-After` of the 503 answered when the queue refuses the task. */
const ENQUEUE_RETRY_AFTER_SECONDS = 5;

/** What resend needs from the certificates module (structurally satisfied by `CertificateService`). */
export interface ResendCertificateState {
  prepareEmailResend(id: string, options?: { email?: string }): Promise<PrepareEmailResendResult>;
  markEmailFailed(id: string, code: string): Promise<void>;
}

export interface ResendOutcome {
  emailStatus: 'pending';
  emailAttempts: number;
  /** True when a supplied address replaced a different stored one (the caller audits it). */
  emailChanged: boolean;
}

export interface EmailResendService {
  /**
   * Admin resend (BEU-ICT/certificate-manager#377). `email` must be validated and lowercased by the
   * caller. Order: throttle (5 per certificate per 24 h, `RateLimitedError`; every attempt that
   * reaches this step counts, also refused ones), then the transactional state change
   * (`NotFoundError`; `ConflictError` `CERTIFICATE_REVOKED` / `EMAIL_IN_PROGRESS`;
   * `UnprocessableError` `EMAIL_REQUIRED`), then the enqueue of `email-<id>-<n>`. If the queue
   * refuses the task the certificate is marked `failed` / `ENQUEUE_FAILED` and `UnavailableError`
   * (503) is thrown; the address change (if any) is kept and the admin may retry.
   */
  resend(id: string, options?: { email?: string }): Promise<ResendOutcome>;
}

export interface EmailResendDeps {
  certificates: ResendCertificateState;
  taskQueue: TaskQueue;
  /**
   * Counter store for the throttle, keyed `email-resend:<certificateId>`. With the in-process
   * limiter the count is per instance (and lost on restart), so the effective limit is
   * 5 x instances; a shared `RateLimiter` adapter makes it exact.
   */
  rateLimiter: RateLimiter;
  clock: Clock;
  logger?: NotificationsLogger;
}

export class DefaultEmailResendService implements EmailResendService {
  constructor(private readonly deps: EmailResendDeps) {}

  async resend(rawId: string, options: { email?: string } = {}): Promise<ResendOutcome> {
    const { certificates, taskQueue, rateLimiter, clock, logger } = this.deps;
    const id = parseCertificateId(rawId);

    const limit = await rateLimiter.consume(`email-resend:${id}`, {
      limit: RESEND_LIMIT,
      windowMs: RESEND_WINDOW_MS,
    });
    if (!limit.allowed) {
      const seconds = Math.max(
        1,
        Math.ceil((limit.resetAt.getTime() - clock.now().getTime()) / 1000),
      );
      throw new RateLimitedError(seconds, 'Too many resends for this certificate');
    }

    const prepared = await certificates.prepareEmailResend(id, options);
    switch (prepared.outcome) {
      case 'not_found':
        throw new NotFoundError('Certificate not found');
      case 'revoked':
        throw new ConflictError('The certificate is revoked', [
          { path: 'status', message: CERTIFICATE_REVOKED },
        ]);
      case 'email_required':
        throw new UnprocessableError(EMAIL_REQUIRED, 'The certificate has no e-mail address');
      case 'in_progress':
        throw new ConflictError('An e-mail is already being sent', [
          { path: 'emailStatus', message: EMAIL_IN_PROGRESS },
        ]);
      case 'reserved':
        break;
    }

    const payload: SendEmailTaskPayload = { certificateId: id, sequence: prepared.sequence };
    try {
      await taskQueue.enqueue({
        name: emailTaskName(id, prepared.sequence),
        handler: SEND_EMAIL_HANDLER,
        payload,
        dedupe: true,
      });
    } catch (error) {
      logger?.error(
        { certificateId: id, errorName: error instanceof Error ? error.name : 'unknown' },
        'resend e-mail task could not be enqueued',
      );
      await certificates.markEmailFailed(id, ENQUEUE_FAILED);
      throw new UnavailableError(
        ENQUEUE_RETRY_AFTER_SECONDS,
        'The e-mail could not be queued; try again',
      );
    }
    return {
      emailStatus: 'pending',
      emailAttempts: prepared.sequence,
      emailChanged: prepared.emailChanged,
    };
  }
}
