import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function EmptyState({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line bg-surface-muted px-4 py-10 text-center">
      <h2 className="text-lg font-semibold text-ink">{title ?? t('ui.empty.title')}</h2>
      {description ? <p className="max-w-md text-base text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
