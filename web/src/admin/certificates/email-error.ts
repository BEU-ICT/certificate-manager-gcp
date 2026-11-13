import type { TFunction } from 'i18next';

/**
 * Human message for `emailLastError`: a bare code (`ENQUEUE_FAILED`, `RETRIES_EXHAUSTED`,
 * `DAILY_CAP_EXHAUSTED`) or `CODE: reason` (`REJECTED`, `BOUNCED`). Unknown values use a generic text
 * rather than echoing server text; the reason of the two prefixed codes is shown as plain text.
 */
export function emailErrorMessage(t: TFunction<'admin'>, error: string): string {
  const colon = error.indexOf(':');
  const code = (colon === -1 ? error : error.slice(0, colon)).trim();
  const reason = colon === -1 ? '' : error.slice(colon + 1).trim();
  switch (code) {
    case 'ENQUEUE_FAILED':
      return t('admin:certificates.emailError.ENQUEUE_FAILED');
    case 'RETRIES_EXHAUSTED':
      return t('admin:certificates.emailError.RETRIES_EXHAUSTED');
    case 'DAILY_CAP_EXHAUSTED':
      return t('admin:certificates.emailError.DAILY_CAP_EXHAUSTED');
    case 'REJECTED':
      return reason
        ? t('admin:certificates.emailError.REJECTED', { reason })
        : t('admin:certificates.emailError.unknown');
    case 'BOUNCED':
      return reason
        ? t('admin:certificates.emailError.BOUNCED', { reason })
        : t('admin:certificates.emailError.unknown');
    default:
      return t('admin:certificates.emailError.unknown');
  }
}
