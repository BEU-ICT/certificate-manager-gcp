import { useTranslation } from 'react-i18next';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message?: string;
  /** The API `requestId`, shown so users can quote it to support. */
  requestId?: string | undefined;
  onRetry?: () => void;
}

export function ErrorState({ title, message, requestId, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-card border border-danger bg-danger-soft px-4 py-10 text-center"
    >
      <h2 className="text-lg font-semibold text-danger">{title ?? t('ui.error.title')}</h2>
      {message ? <p className="max-w-md text-base text-ink">{message}</p> : null}
      {requestId ? (
        <p className="break-all text-sm text-ink-muted">
          <code>{t('ui.error.requestId', { id: requestId })}</code>
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          {t('ui.error.retry')}
        </Button>
      ) : null}
    </div>
  );
}
