import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components';
import { StateCard } from './StateCard';

/** Fallback when the response carries no usable `Retry-After`. */
export const DEFAULT_RETRY_SECONDS = 30;

/**
 * 429: counts down the `Retry-After` seconds and calls `onRetry` when it reaches zero. The
 * announcement for assistive technology states the initial wait once; the ticking number is
 * visual only so a screen reader is not interrupted every second.
 */
export function RateLimited({ seconds, onRetry }: { seconds: number; onRetry: () => void }) {
  const { t } = useTranslation('public');
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onRetry();
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
    // `onRetry` is stable enough for a single fire; re-running on it would restart the countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  return (
    <StateCard title={t('certificate.rateLimited.title')}>
      <p role="status" className="sr-only">
        {t('certificate.rateLimited.message', { count: seconds })}
      </p>
      <p aria-hidden="true">{t('certificate.rateLimited.message', { count: remaining })}</p>
      <Button variant="secondary" className="print:hidden" onClick={onRetry}>
        {t('certificate.rateLimited.retryNow')}
      </Button>
    </StateCard>
  );
}
