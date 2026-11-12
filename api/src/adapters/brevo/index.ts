import type { EmailSender } from '../../ports/index.js';
import { AdapterError, type AdapterContext } from '../registry.js';
import { BrevoEmailSender } from './brevo-email-sender.js';

/** `EMAIL_PROVIDER=brevo` / `EMAIL_FALLBACK_PROVIDER=brevo`. The key comes from `EMAIL_API_KEY`. */
export function createEmailSender({ config }: AdapterContext): EmailSender {
  const { apiKey, fromName } = config.email;
  if (!apiKey) throw new AdapterError('EMAIL_PROVIDER: brevo needs EMAIL_API_KEY');
  return new BrevoEmailSender({ apiKey, fromName });
}
