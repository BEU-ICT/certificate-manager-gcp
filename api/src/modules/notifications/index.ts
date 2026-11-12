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
export type { ComposedContent, MessageComposer, MessageLinks } from './message-composer.js';
export {
  TemplateMessageComposer,
  escapeHtml,
  markup,
  oneLine,
  renderCertificateEmail,
  truncate,
  type TemplateInput,
} from './email-templates.js';
export { SendEmailRetryError, createInProcessSendEmailTask } from './in-process-task.js';
export {
  CERTIFICATE_REVOKED,
  DefaultEmailResendService,
  EMAIL_IN_PROGRESS,
  EMAIL_REQUIRED,
  RESEND_LIMIT,
  RESEND_WINDOW_MS,
  type EmailResendDeps,
  type EmailResendService,
  type ResendCertificateState,
  type ResendOutcome,
} from './resend.js';
