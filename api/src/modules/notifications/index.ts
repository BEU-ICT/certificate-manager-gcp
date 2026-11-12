/** Public interface of the notifications module; other modules import only this file. */
export {
  ENQUEUE_FAILED,
  ISSUED_EMAIL_SUBSCRIBER,
  createIssuedEmailHandler,
  registerIssuedEmailSubscriber,
  type EmailCertificateState,
  type IssuedEmailSubscriberDeps,
  type NotificationsLogger,
} from './issued-email-subscriber.js';
export {
  DAILY_CAP_EXHAUSTED,
  LAST_RETRY_COUNT,
  rescheduleTime,
  RETRIES_EXHAUSTED,
  createSendEmailHandler,
  emailMessageId,
  type DailyQuotaDeps,
  type SendEmailCertificates,
  type SendEmailHandlerDeps,
  type SendEmailLogger,
  type SendEmailOutcome,
  type SendEmailRequest,
} from './send-email-handler.js';
export {
  PlainMessageComposer,
  type ComposedContent,
  type MessageComposer,
} from './message-composer.js';
export { SendEmailRetryError, createInProcessSendEmailTask } from './in-process-task.js';
