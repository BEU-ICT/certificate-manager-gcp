import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { isApiError } from '@/api';
import {
  Button,
  EmptyState,
  ErrorState,
  Pagination,
  Select,
  Skeleton,
  Table,
  type Column,
} from '@/components';
import { errorMessage } from '@/i18n/errors';
import { isLanguage, DEFAULT_LANGUAGE } from '@/i18n/language';
import { formatDate } from '@/lib/format';
import { useEventList, type CertificateEvent } from './api';
import { CreateEventDialog } from './CreateEventDialog';
import { DeleteEventDialog } from './DeleteEventDialog';
import { EditEventDialog } from './EditEventDialog';
import { EMAIL_LANGUAGE_LABEL } from './form';
import { OrganizationSelect } from './OrganizationSelect';

const PAGE_SIZES = [25, 50] as const;
const FILTER_PARAM = 'organizationId';

type Dialogs =
  | { kind: 'create' }
  | { kind: 'edit'; event: CertificateEvent }
  | { kind: 'delete'; event: CertificateEvent }
  | null;

/** `/admin/events`: list (filter by organization, kept in the URL), create, edit and delete. */
export default function EventsPage() {
  const { t, i18n } = useTranslation('admin');
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const [params, setParams] = useSearchParams();
  const organizationId = params.get(FILTER_PARAM) || undefined;
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  // Cursor history: the last entry is the current page (`undefined` = first page).
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const cursor = cursors[cursors.length - 1];
  const query = useEventList(organizationId, limit, cursor);
  const { data } = query;

  if (data && data.items.length === 0 && cursors.length > 1 && !query.isPlaceholderData) {
    setCursors((list) => list.slice(0, -1));
  }

  function setFilter(value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(FILTER_PARAM, value);
        else next.delete(FILTER_PARAM);
        return next;
      },
      { replace: true },
    );
    setCursors([undefined]);
  }

  const columns: Column<CertificateEvent>[] = [
    { key: 'name', header: t('events.columns.name'), cell: (e) => e.name },
    {
      key: 'organization',
      header: t('events.columns.organization'),
      cell: (e) => e.organizationName,
    },
    {
      key: 'slug',
      header: t('events.columns.slug'),
      cell: (e) => <code className="text-sm">{e.slug}</code>,
    },
    {
      key: 'emailLanguage',
      header: t('events.columns.emailLanguage'),
      cell: (e) => EMAIL_LANGUAGE_LABEL[e.emailLanguage],
    },
    {
      key: 'createdAt',
      header: t('events.columns.createdAt'),
      cell: (e) => formatDate(e.createdAt, language),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('events.columns.actions')}</span>,
      className: 'text-right',
      cell: (e) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            aria-label={t('events.edit.action', { name: e.name })}
            onClick={() => setDialog({ kind: 'edit', event: e })}
          >
            {t('events.edit.label')}
          </Button>
          <Button
            variant="ghost"
            aria-label={t('events.delete.action', { name: e.name })}
            onClick={() => setDialog({ kind: 'delete', event: e })}
          >
            {t('events.delete.label')}
          </Button>
        </div>
      ),
    },
  ];

  const createButton = (
    <Button onClick={() => setDialog({ kind: 'create' })}>{t('events.create.open')}</Button>
  );
  const close = () => setDialog(null);

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
        <span className="sr-only">{t('events.loading')}</span>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (data.items.length === 0 && cursors.length === 1) {
    body = (
      <EmptyState
        title={organizationId ? t('events.empty.filteredTitle') : t('events.empty.title')}
        description={
          organizationId ? t('events.empty.filteredDescription') : t('events.empty.description')
        }
        action={createButton}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <Table
          caption={t('events.title')}
          columns={columns}
          rows={data.items}
          getRowKey={(e) => e.id}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Select
            label={t('events.pageSize')}
            placeholder={null}
            value={String(limit)}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              setCursors([undefined]);
            }}
          />
          <Pagination
            className="flex-1 min-w-48"
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

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('events.title')}
        </h1>
        {data && (data.items.length > 0 || organizationId) ? createButton : null}
      </div>
      <OrganizationSelect
        label={t('events.filter.label')}
        placeholder={t('events.filter.all')}
        value={organizationId ?? ''}
        onChange={setFilter}
        fallbackLabel={data?.items[0]?.organizationName}
      />
      {body}
      {dialog?.kind === 'create' ? (
        <CreateEventDialog organizationId={organizationId} onClose={close} />
      ) : null}
      {dialog?.kind === 'edit' ? <EditEventDialog event={dialog.event} onClose={close} /> : null}
      {dialog?.kind === 'delete' ? (
        <DeleteEventDialog event={dialog.event} onClose={close} />
      ) : null}
    </section>
  );
}
