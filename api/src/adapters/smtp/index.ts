import type { EmailSender } from '../../ports/index.js';
import { AdapterError, type AdapterContext } from '../registry.js';
import { SmtpEmailSender } from './smtp-email-sender.js';

/** `EMAIL_PROVIDER=smtp` / `EMAIL_FALLBACK_PROVIDER=smtp`: any SMTP server (host, port, TLS, auth from env). */
export function createEmailSender({ config }: AdapterContext): EmailSender {
  const smtp = config.email.smtp;
  if (!smtp.host) throw new AdapterError('EMAIL_PROVIDER: smtp needs SMTP_HOST');
  return new SmtpEmailSender({
    host: smtp.host,
    port: smtp.port,
    tls: smtp.tls,
    user: smtp.user,
    password: smtp.password,
  });
}
