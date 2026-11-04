import { useTranslation } from 'react-i18next';
import { cx } from './cx';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <span role="status" className={cx('inline-flex', className)}>
      <svg
        className="size-5 animate-spin"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" />
      </svg>
      <span className="sr-only">{label ?? t('ui.loading')}</span>
    </span>
  );
}

/** Decorative placeholder shown while content loads; hidden from assistive technology. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('animate-pulse rounded-control bg-line/60', className)} />
  );
}
