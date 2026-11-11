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
