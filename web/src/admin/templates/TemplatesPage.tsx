import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { isApiError } from '@/api';
import {
  Badge,
  EmptyState,
  ErrorState,
  Pagination,
  Select,
  Skeleton,
  Table,
  type Column,
} from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage } from '@/i18n/language';
import { CERTIFICATE_TYPES, certificateTypeLabel } from '@/lib/certificateTypes';
import { formatDate } from '@/lib/format';
import { OrganizationSelect } from '../events/OrganizationSelect';
import { useTemplateList, type Template } from './api';
import { CopyButton } from './CopyButton';
import { EventSelect } from './EventSelect';

const PAGE_SIZES = [25, 50] as const;

/** `/admin/templates`: template versions, filtered by organization, event and type (kept in the URL). */
export default function TemplatesPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const [params, setParams] = useSearchParams();
  const organizationId = params.get('organizationId') || undefined;
  const eventId = params.get('eventId') || undefined;
  const typeParam = params.get('type');
  const type =
    typeParam && (CERTIFICATE_TYPES as readonly string[]).includes(typeParam)
      ? typeParam
      : undefined;
  const filtered = Boolean(organizationId || eventId || type);
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  // Cursor history: the last entry is the current page (`undefined` = first page).
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const query = useTemplateList({ organizationId, eventId, type }, limit, cursor);
  const { data } = query;

  // An empty page past the first one (its items were removed) keeps the pagination, so the user can step back.

  function setFilters(changes: Record<string, string>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
    setCursors([undefined]);
  }

  const columns: Column<Template>[] = [
    {
      key: 'reference',
      header: t('templates.columns.reference'),
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Link
            to={`/admin/templates/${encodeURIComponent(row.reference)}`}
            className="font-mono text-primary underline"
          >
            {row.reference}
          </Link>
          <CopyButton
            value={row.reference}
            label={t('templates.copyReference', { reference: row.reference })}
          />
        </div>
      ),
    },
    {
      key: 'organization',
      header: t('templates.columns.organization'),
      cell: (row) => row.organizationSlug,
    },
    { key: 'event', header: t('templates.columns.event'), cell: (row) => row.eventSlug },
    {
      key: 'type',
      header: t('templates.columns.type'),
      cell: (row) => certificateTypeLabel(t, row.type),
    },
    {
      key: 'version',
      header: t('templates.columns.version'),
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          <Badge>{`v${row.version}`}</Badge>
          {row.isLatest ? <Badge tone="success">{t('templates.latest')}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t('templates.columns.createdAt'),
      cell: (row) => formatDate(row.createdAt, language),
    },
  ];

  const uploadButton = (
    <Link
      to="/admin/templates/new"
      className="inline-flex min-h-11 items-center justify-center rounded-control border border-transparent bg-primary px-4 py-2 text-base font-medium text-white hover:bg-primary-hover"
    >
      {t('templates.upload')}
    </Link>
  );

  let body;
  if (query.isError && !data) {
    body = (
      <ErrorState
        message={errorMessage(t, isApiError(query.error) ? query.error.code : undefined)}
        requestId={isApiError(query.error) ? query.error.requestId : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (!data) {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">{t('templates.loading')}</span>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (data.items.length === 0 && cursors.length === 1) {
    body = (
      <EmptyState
        title={filtered ? t('templates.empty.filteredTitle') : t('templates.empty.title')}
        description={
          filtered ? t('templates.empty.filteredDescription') : t('templates.empty.description')
        }
        action={uploadButton}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <Table
          caption={t('templates.title')}
          columns={columns}
          rows={data.items}
          getRowKey={(row) => row.reference}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Select
            label={t('templates.pageSize')}
            placeholder={null}
            value={String(limit)}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              setCursors([undefined]);
            }}
          />
          <Pagination
            className="min-w-48 flex-1"
            hasPrevious={cursors.length > 1}
            hasNext={data.nextCursor !== null}
            loading={query.isPlaceholderData}
            onPrevious={() => setCursors((list) => list.slice(0, -1))}
            onNext={() => {
              if (data.nextCursor !== null) setCursors((list) => [...list, data.nextCursor!]);
            }}
          />
        </div>
      </div>
    );
  }

  const first = data?.items[0];
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('templates.title')}
        </h1>
        {data && (data.items.length > 0 || filtered) ? uploadButton : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <OrganizationSelect
          label={t('templates.fields.organization')}
          placeholder={t('templates.filter.allOrganizations')}
          value={organizationId ?? ''}
          fallbackLabel={first?.organizationSlug}
          onChange={(value) => setFilters({ organizationId: value, eventId: '' })}
        />
        <EventSelect
          label={t('templates.fields.event')}
          placeholder={t('templates.filter.allEvents')}
          organizationId={organizationId ?? ''}
          value={eventId ?? ''}
          fallbackLabel={first?.eventSlug}
          onChange={(value) => setFilters({ eventId: value })}
        />
        <Select
          label={t('templates.fields.type')}
          placeholder={t('templates.filter.allTypes')}
          value={type ?? ''}
          options={CERTIFICATE_TYPES.map((c) => ({
            value: c,
            label: t(`common:certificateTypes.${c}`),
          }))}
          onChange={(event) => setFilters({ type: event.target.value })}
        />
      </div>
      {body}
    </section>
  );
}
