import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useOrganizationList, type Organization } from './api';
import { CreateOrganizationDialog } from './CreateOrganizationDialog';
import { DeleteOrganizationDialog } from './DeleteOrganizationDialog';
import { RenameOrganizationDialog } from './RenameOrganizationDialog';

const PAGE_SIZES = [25, 50] as const;

type Dialogs =
  | { kind: 'create' }
  | { kind: 'rename'; organization: Organization }
  | { kind: 'delete'; organization: Organization }
  | null;

/** `/admin/organizations`: list, create, rename and delete. */
export default function OrganizationsPage() {
  const { t, i18n } = useTranslation('admin');
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  // Cursor history: the last entry is the current page (`undefined` = first page).
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const cursor = cursors[cursors.length - 1];
  const query = useOrganizationList(limit, cursor);
  const { data } = query;

  // The last row of a later page was deleted: step back instead of showing an empty page
  // (state adjusted during render, see react.dev "adjusting state when a prop changes").
  if (data && data.items.length === 0 && cursors.length > 1 && !query.isPlaceholderData) {
    setCursors((list) => list.slice(0, -1));
  }

  const columns: Column<Organization>[] = [
    { key: 'name', header: t('organizations.columns.name'), cell: (o) => o.name },
    {
      key: 'slug',
      header: t('organizations.columns.slug'),
      cell: (o) => <code className="text-sm">{o.slug}</code>,
    },
    {
      key: 'createdAt',
      header: t('organizations.columns.createdAt'),
      cell: (o) => formatDate(o.createdAt, language),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('organizations.columns.actions')}</span>,
      className: 'text-right',
      cell: (o) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            aria-label={t('organizations.rename.action', { name: o.name })}
            onClick={() => setDialog({ kind: 'rename', organization: o })}
          >
            {t('organizations.rename.label')}
          </Button>
          <Button
            variant="ghost"
            aria-label={t('organizations.delete.action', { name: o.name })}
            onClick={() => setDialog({ kind: 'delete', organization: o })}
          >
            {t('organizations.delete.label')}
          </Button>
        </div>
      ),
    },
  ];

  const createButton = (
    <Button onClick={() => setDialog({ kind: 'create' })}>{t('organizations.create.open')}</Button>
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
        <span className="sr-only">{t('organizations.loading')}</span>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (data.items.length === 0 && cursors.length === 1) {
    body = (
      <EmptyState
        title={t('organizations.empty.title')}
        description={t('organizations.empty.description')}
        action={createButton}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <Table
          caption={t('organizations.title')}
          columns={columns}
          rows={data.items}
          getRowKey={(o) => o.id}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Select
            label={t('organizations.pageSize')}
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
          {t('organizations.title')}
        </h1>
        {data && data.items.length > 0 ? createButton : null}
      </div>
      {body}
      {dialog?.kind === 'create' ? <CreateOrganizationDialog onClose={close} /> : null}
      {dialog?.kind === 'rename' ? (
        <RenameOrganizationDialog organization={dialog.organization} onClose={close} />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <DeleteOrganizationDialog organization={dialog.organization} onClose={close} />
      ) : null}
    </section>
  );
}
