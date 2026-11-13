import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { isApiError } from '@/api';
import {
  Badge,
  Button,
  DatePicker,
  EmptyState,
  ErrorState,
  Pagination,
  Select,
  Skeleton,
  Table,
  type BadgeTone,
  type Column,
} from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage } from '@/i18n/language';
import { CERTIFICATE_TYPES, certificateTypeLabel } from '@/lib/certificateTypes';
import { formatDate, formatNumber } from '@/lib/format';
import { OrganizationSelect } from '../events/OrganizationSelect';
import { EmailStatusBadge } from './EmailStatusBadge';
import { CopyButton } from '../templates/CopyButton';
import { EventSelect } from '../templates/EventSelect';
import {
  useCertificateCount,
  useCertificateList,
  type CertificateFilters,
  type CertificateSummary,
} from './api';

const PAGE_SIZES = [25, 50] as const;
const STATUSES = ['active', 'revoked'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
const FILTER_KEYS = [
  'organizationId',
  'eventId',
  'type',
  'status',
  'issuedFrom',
  'issuedTo',
  'emailStatus',
];

const STATUS_TONE: Record<CertificateSummary['status'], BadgeTone> = {
  active: 'success',
  revoked: 'danger',
};

const linkClass =
  'inline-flex min-h-11 items-center justify-center rounded-control border px-4 py-2 text-base font-medium';

/** `/admin/certificates`: issued certificates, filtered by organization, event, type, status and date (kept in the URL). */
export default function CertificatesPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const organizationId = params.get('organizationId') || undefined;
  const eventId = params.get('eventId') || undefined;
  const typeParam = params.get('type');
  const type =
    typeParam && (CERTIFICATE_TYPES as readonly string[]).includes(typeParam)
      ? (typeParam as CertificateSummary['type'])
      : undefined;
  const statusParam = params.get('status');
  const status = (STATUSES as readonly string[]).includes(statusParam ?? '')
    ? (statusParam as CertificateSummary['status'])
    : undefined;
  const emailParam = params.get('emailStatus');
  const emailStatus = (EMAIL_STATUSES as readonly string[]).includes(emailParam ?? '')
    ? (emailParam as CertificateSummary['emailStatus'])
    : undefined;
  const fromParam = params.get('issuedFrom');
  const issuedFrom = fromParam && DATE_RE.test(fromParam) ? fromParam : undefined;
  const toParam = params.get('issuedTo');
  const issuedTo = toParam && DATE_RE.test(toParam) ? toParam : undefined;
  const rangeInvalid = Boolean(issuedFrom && issuedTo && issuedTo < issuedFrom);
  const filtered = FILTER_KEYS.some((key) => params.has(key));
  const filters: CertificateFilters = {
    organizationId,
    eventId,
    type,
    status,
    emailStatus,
    issuedFrom,
    issuedTo,
  };

  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  // Cursor history: the last entry is the current page (`undefined` = first page).
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const query = useCertificateList(filters, limit, cursor, !rangeInvalid);
  const count = useCertificateCount(filters, !rangeInvalid);
  const { data } = query;

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

  function clearFilters() {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of FILTER_KEYS) next.delete(key);
        return next;
      },
      { replace: true },
    );
    setCursors([undefined]);
  }

  const detailPath = (row: CertificateSummary) =>
    `/admin/certificates/${encodeURIComponent(row.id)}`;

  const columns: Column<CertificateSummary>[] = [
    {
      key: 'owner',
      header: t('certificates.columns.owner'),
      cell: (row) => (
        <Link to={detailPath(row)} className="text-primary underline">
          {row.ownerName}
        </Link>
      ),
    },
    { key: 'event', header: t('certificates.columns.event'), cell: (row) => row.eventName },
    {
      key: 'organization',
      header: t('certificates.columns.organization'),
      cell: (row) => row.organizationName,
    },
    {
      key: 'type',
      header: t('certificates.columns.type'),
      cell: (row) => certificateTypeLabel(t, row.type),
    },
    { key: 'subject', header: t('certificates.columns.subject'), cell: (row) => row.subject },
    {
      key: 'issuedAt',
      header: t('certificates.columns.issuedAt'),
      cell: (row) => formatDate(row.issuedAt, language),
    },
    {
      key: 'status',
      header: t('certificates.columns.status'),
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>{t(`certificates.status.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'emailStatus',
      header: t('certificates.columns.emailStatus'),
      cell: (row) => <EmailStatusBadge status={row.emailStatus} />,
    },
    {
      key: 'id',
      header: t('certificates.columns.id'),
      cell: (row) => (
        <CopyButton value={row.id} label={t('certificates.copyId', { owner: row.ownerName })} />
      ),
    },
  ];

  // TODO: the issue and import screens are separate tasks; these routes may not exist yet.
  const quickLinks = (
    <div className="flex flex-wrap gap-2">
      <Link
        to="/admin/certificates/new"
        className={`${linkClass} border-transparent bg-primary text-white hover:bg-primary-hover`}
      >
        {t('certificates.issue')}
      </Link>
      <Link
        to="/admin/certificates/import"
        className={`${linkClass} border-line bg-surface text-ink hover:bg-surface-muted`}
      >
        {t('certificates.import')}
      </Link>
    </div>
  );

  let body;
  if (rangeInvalid) {
    body = null;
  } else if (query.isError && !data) {
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
        <span className="sr-only">{t('certificates.loading')}</span>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (data.items.length === 0 && cursors.length === 1) {
    body = (
      <EmptyState
        title={filtered ? t('certificates.empty.filteredTitle') : t('certificates.empty.title')}
        description={
          filtered
            ? t('certificates.empty.filteredDescription')
            : t('certificates.empty.description')
        }
        action={
          filtered ? (
            <Button variant="secondary" onClick={clearFilters}>
              {t('certificates.clearFilters')}
            </Button>
          ) : (
            quickLinks
          )
        }
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <Table
          caption={t('certificates.title')}
          columns={columns}
          rows={data.items}
          getRowKey={(row) => row.id}
          onRowClick={(row) => void navigate(detailPath(row))}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Select
            label={t('certificates.pageSize')}
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
  let total: string | null = null;
  if (!rangeInvalid) {
    if (count.data)
      total = t('certificates.total', { total: formatNumber(count.data.count, language) });
    else if (count.isError) total = t('certificates.totalUnavailable');
  }
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('certificates.title')}
        </h1>
        {quickLinks}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <OrganizationSelect
          label={t('certificates.fields.organization')}
          placeholder={t('certificates.filter.allOrganizations')}
          value={organizationId ?? ''}
          fallbackLabel={first?.organizationName}
          onChange={(value) => setFilters({ organizationId: value, eventId: '' })}
        />
        <EventSelect
          label={t('certificates.fields.event')}
          placeholder={t('certificates.filter.allEvents')}
          organizationId={organizationId ?? ''}
          value={eventId ?? ''}
          fallbackLabel={first?.eventName}
          onChange={(value) => setFilters({ eventId: value })}
        />
        <Select
          label={t('certificates.fields.type')}
          placeholder={t('certificates.filter.allTypes')}
          value={type ?? ''}
          options={CERTIFICATE_TYPES.map((c) => ({
            value: c,
            label: t(`common:certificateTypes.${c}`),
          }))}
          onChange={(event) => setFilters({ type: event.target.value })}
        />
        <Select
          label={t('certificates.fields.status')}
          placeholder={t('certificates.filter.allStatuses')}
          value={status ?? ''}
          options={STATUSES.map((s) => ({ value: s, label: t(`certificates.status.${s}`) }))}
          onChange={(event) => setFilters({ status: event.target.value })}
        />
        <Select
          label={t('certificates.fields.emailStatus')}
          placeholder={t('certificates.filter.allEmailStatuses')}
          value={emailStatus ?? ''}
          options={EMAIL_STATUSES.map((s) => ({
            value: s,
            label: t(`certificates.emailStatus.${s}`),
          }))}
          onChange={(event) => setFilters({ emailStatus: event.target.value })}
        />
        <DatePicker
          label={t('certificates.fields.issuedFrom')}
          value={issuedFrom ?? ''}
          max={issuedTo}
          onChange={(event) => setFilters({ issuedFrom: event.target.value })}
        />
        <DatePicker
          label={t('certificates.fields.issuedTo')}
          value={issuedTo ?? ''}
          min={issuedFrom}
          error={rangeInvalid ? t('certificates.rangeInvalid') : undefined}
          onChange={(event) => setFilters({ issuedTo: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p aria-live="polite" className="text-ink-muted">
          {total}
        </p>
        {filtered ? (
          <Button variant="secondary" onClick={clearFilters}>
            {t('certificates.clearFilters')}
          </Button>
        ) : null}
      </div>
      {body}
    </section>
  );
}
