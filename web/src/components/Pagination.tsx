import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { cx } from './cx';

export interface PaginationProps {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  loading?: boolean;
  className?: string;
}

/** Cursor pagination: only previous/next, no page numbers (the API returns an opaque cursor). */
export function Pagination({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  loading,
  className,
}: PaginationProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('ui.pagination.label')}
      className={cx('flex justify-between gap-2', className)}
    >
      <Button variant="secondary" disabled={!hasPrevious || loading} onClick={onPrevious}>
        <span aria-hidden="true">←</span> {t('ui.pagination.previous')}
      </Button>
      <Button variant="secondary" disabled={!hasNext || loading} onClick={onNext}>
        {t('ui.pagination.next')} <span aria-hidden="true">→</span>
      </Button>
    </nav>
  );
}
