import type { DomainEvents, EventBus, TaskQueue } from '../../ports/index.js';
import {
  SEND_EMAIL_HANDLER,
  emailTaskName,
  type SendEmailTaskPayload,
} from '../../shared/email-task.js';

/** `emailLastError` recorded when the queue refuses the task. */
export const ENQUEUE_FAILED = 'ENQUEUE_FAILED';
export const ISSUED_EMAIL_SUBSCRIBER = 'notifications.enqueue-issued-email';

/**
 * What notifications needs from the certificates module. Declared here (satisfied structurally by
 * `CertificateService`) so notifications never imports certificates internals.
 */
export interface EmailCertificateState {
  reserveEmailSend(id: string): Promise<number | null>;
  markEmailFailed(id: string, code: string): Promise<void>;
}

/** Minimal logger surface; satisfied by pino. Only certificate IDs are ever logged. */
export interface NotificationsLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface IssuedEmailSubscriberDeps {
  certificates: EmailCertificateState;
  taskQueue: TaskQueue;
  logger: NotificationsLogger;
}

/**
 * Handler of `certificate.issued` (BEU-ICT/certificate-manager#367). Never throws: issuance must
 * not be affected by a notification problem.
 *
 * - `hasEmail=false`: nothing happens.
 * - Otherwise reserve the first send (`emailAttempts` 0 -> 1, only while `pending`); a certificate
 *   that was already reserved (duplicate delivery) yields `null` and nothing is enqueued.
 * - Enqueue `email-<id>-<n>` with `dedupe: true`; on failure mark `failed` / `ENQUEUE_FAILED`.
 */
export function createIssuedEmailHandler(
  deps: IssuedEmailSubscriberDeps,
): (event: DomainEvents['certificate.issued']) => Promise<void> {
  const { certificates, taskQueue, logger } = deps;
  return async (event) => {
    if (!event.hasEmail) return;
    const id = event.certificateId;
    try {
      const sequence = await certificates.reserveEmailSend(id);
      if (sequence === null) return;
      const payload: SendEmailTaskPayload = { certificateId: id, sequence };
      try {
        await taskQueue.enqueue({
          name: emailTaskName(id, sequence),
          handler: SEND_EMAIL_HANDLER,
          payload,
          dedupe: true,
        });
      } catch (error) {
        logger.error(
          { certificateId: id, errorName: errorName(error) },
          'e-mail task could not be enqueued',
        );
        await certificates.markEmailFailed(id, ENQUEUE_FAILED);
      }
    } catch (error) {
      // reserve or markEmailFailed failed (store problem): nothing more can be recorded.
      logger.error(
        { certificateId: id, errorName: errorName(error) },
        'e-mail enqueue bookkeeping failed',
      );
    }
  };
}

/** Class name only: messages of SDK errors may contain request data. */
const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown');

/** Subscribes the handler on the bus; returns the unsubscribe function. Called by the composition root. */
export function registerIssuedEmailSubscriber(
  eventBus: EventBus,
  deps: IssuedEmailSubscriberDeps,
): () => void {
  return eventBus.subscribe(
    'certificate.issued',
    ISSUED_EMAIL_SUBSCRIBER,
    createIssuedEmailHandler(deps),
  );
}
