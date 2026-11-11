import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select } from '@/components';
import { useEventOptions } from './api';

/** Native select over the events of `organizationId`; disabled while no organization is chosen. */
export function EventSelect({
  organizationId,
  value,
  onChange,
  label,
  placeholder,
  required,
  error,
  fallbackLabel,
}: {
  organizationId: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  required?: boolean;
  error?: string | undefined;
  fallbackLabel?: string | undefined;
}) {
  const { t } = useTranslation('admin');
  const query = useEventOptions(organizationId);
  const options = useMemo(() => {
    const list = (query.data?.pages ?? []).flatMap((p) =>
      p.items.map((e) => ({ value: e.id, label: e.name })),
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
        disabled={organizationId === ''}
        value={value}
        options={options}
        onChange={(event) => onChange(event.target.value)}
      />
      {query.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-danger">
            {t('templates.events.failed')}
          </p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('events.organizations.retry')}
          </Button>
        </div>
      ) : null}
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t('templates.events.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
