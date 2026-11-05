import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select } from '@/components';
import { useOrganizationOptions } from './api';

/**
 * Native select over the organizations, loaded lazily (50 per page) with a "Load more" button
 * below it while more pages exist. A native select keeps keyboard and screen-reader behaviour
 * for free; the options come from the shared, cached `useOrganizationOptions` query.
 */
export function OrganizationSelect({
  label,
  value,
  onChange,
  placeholder,
  required,
  error,
  hint,
  fallbackLabel,
  autoFocus,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string;
  /** Label for a selected id that is not (yet) in the loaded pages, e.g. from the URL. */
  fallbackLabel?: string | undefined;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation('admin');
  const query = useOrganizationOptions();
  const options = useMemo(() => {
    const list = (query.data?.pages ?? []).flatMap((p) =>
      p.items.map((o) => ({ value: o.id, label: o.name })),
    );
    if (value && !list.some((o) => o.value === value)) {
      list.unshift({ value, label: fallbackLabel ?? value });
    }
    return list;
  }, [query.data, value, fallbackLabel]);

  return (
    <div className="flex flex-col gap-2">
      <Select
        label={label}
        placeholder={placeholder}
        {...(required ? { required } : {})}
        {...(error ? { error } : {})}
        {...(hint ? { hint } : {})}
        value={value}
        options={options}
        data-autofocus={autoFocus ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {query.isError ? (
        <p role="alert" className="text-danger">
          {t('events.organizations.failed')}{' '}
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('events.organizations.retry')}
          </Button>
        </p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('events.organizations.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
