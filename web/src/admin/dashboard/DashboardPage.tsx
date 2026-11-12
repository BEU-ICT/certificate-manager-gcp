import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { isApiError } from '@/api';
import { Button, ErrorState, Skeleton } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage, type Language } from '@/i18n/language';
import { formatNumber } from '@/lib/format';
import { useAdminStats, useRefreshAdminStats } from './api';

const EMAIL_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
const DAY_MS = 86_400_000;

const tileClass =
  'flex flex-col gap-1 rounded-card border bg-surface p-4 hover:bg-surface-muted ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2';
const actionClass =
  'inline-flex min-h-11 items-center justify-center rounded-control border px-4 py-2 text-base font-medium';

function formatDateTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

interface TileProps {
  to: string;
  label: string;
  value: string;
  viewList: string;
  highlight?: boolean;
}

function Tile({ to, label, value, viewList, highlight = false }: TileProps) {
  return (
    <Link
      to={to}
      className={`${tileClass} ${highlight ? 'border-danger bg-danger-soft' : 'border-line'}`}
    >
      <span className={`text-sm ${highlight ? 'font-semibold text-danger' : 'text-ink-muted'}`}>
        {label}
      </span>{' '}
      <span className="text-3xl font-semibold text-ink">{value}</span>{' '}
      <span className="sr-only">{viewList}</span>
    </Link>
  );
}

/** `/admin`: counts for certificates, e-mail delivery and reference data, each linking to its list. */
export default function DashboardPage() {
  const { t, i18n } = useTranslation('admin');
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const query = useAdminStats();
  const refresh = useRefreshAdminStats();
  const stats = query.data;
  const num = (n: number) => formatNumber(n, language);

  const refreshError = refresh.error;
  const refreshMessage = refreshError
    ? refreshError.status === 429
      ? t('dashboard.throttled')
      : errorMessage(t, refreshError.code)
    : null;

  const from = new Date(new Date(stats?.generatedAt ?? 0).getTime() - 30 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const certs = '/admin/certificates';

  // Literal keys so `i18n:check` can see every label.
  const labels = {
    total: t('dashboard.certificates.total'),
    active: t('dashboard.certificates.active'),
    revoked: t('dashboard.certificates.revoked'),
    issuedLast30Days: t('dashboard.certificates.issuedLast30Days'),
    pending: t('dashboard.email.pending'),
    sent: t('dashboard.email.sent'),
    failed: t('dashboard.email.failed'),
    skipped: t('dashboard.email.skipped'),
    organizations: t('dashboard.data.organizations'),
    events: t('dashboard.data.events'),
    templates: t('dashboard.data.templates'),
  };

  function tile(
    group: string,
    key: keyof typeof labels,
    to: string,
    value: number,
    extra?: { highlight?: boolean },
  ) {
    const label = labels[key];
    return (
      <li key={`${group}.${key}`}>
        <Tile
          to={to}
          label={label}
          value={num(value)}
          viewList={t('dashboard.viewList')}
          highlight={extra?.highlight ?? false}
        />
      </li>
    );
  }

  let body;
  if (query.isError && !stats) {
    body = (
      <ErrorState
        message={errorMessage(t, isApiError(query.error) ? query.error.code : undefined)}
        requestId={isApiError(query.error) ? query.error.requestId : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (!stats) {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-6">
        <span className="sr-only">{t('dashboard.loading')}</span>
        {[4, 4, 3].map((n, i) => (
          <div key={i} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: n }, (_, j) => (
              <Skeleton key={j} className="h-24 w-full" />
            ))}
          </div>
        ))}
      </div>
    );
  } else {
    const grid = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4';
    body = (
      <div className="flex flex-col gap-6">
        <section aria-labelledby="dash-certs" className="flex flex-col gap-2">
          <h2 id="dash-certs" className="text-lg font-semibold">
            {t('dashboard.certificates.title')}
          </h2>
          <ul className={grid}>
            {tile('certificates', 'total', certs, stats.certificates.total)}
            {tile('certificates', 'active', `${certs}?status=active`, stats.certificates.active)}
            {tile('certificates', 'revoked', `${certs}?status=revoked`, stats.certificates.revoked)}
            {tile(
              'certificates',
              'issuedLast30Days',
              `${certs}?issuedFrom=${from}`,
              stats.certificates.issuedLast30Days,
            )}
          </ul>
        </section>
        <section aria-labelledby="dash-email" className="flex flex-col gap-2">
          <h2 id="dash-email" className="text-lg font-semibold">
            {t('dashboard.email.title')}
          </h2>
          <ul className={grid}>
            {EMAIL_STATUSES.map((s) =>
              tile('email', s, `${certs}?emailStatus=${s}`, stats.email[s], {
                highlight: s === 'failed' && stats.email.failed > 0,
              }),
            )}
          </ul>
        </section>
        <section aria-labelledby="dash-data" className="flex flex-col gap-2">
          <h2 id="dash-data" className="text-lg font-semibold">
            {t('dashboard.data.title')}
          </h2>
          <ul className={grid}>
            {tile('data', 'organizations', '/admin/organizations', stats.organizations.total)}
            {tile('data', 'events', '/admin/events', stats.events.total)}
            {tile('data', 'templates', '/admin/templates', stats.templates.total)}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('common:layout.nav.dashboard')}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {stats ? (
            <p className="text-sm text-ink-muted">
              {t('dashboard.updatedAt', { time: formatDateTime(stats.generatedAt, language) })}
            </p>
          ) : null}
          <Button
            variant="secondary"
            loading={refresh.isPending}
            disabled={!stats}
            onClick={() => refresh.mutate()}
          >
            {t('dashboard.refresh')}
          </Button>
        </div>
      </div>
      <p role={refreshMessage ? 'alert' : undefined} className="text-danger empty:hidden">
        {refreshMessage}
      </p>
      <nav aria-label={t('dashboard.actions.title')} className="flex flex-wrap gap-2">
        <Link
          to="/admin/certificates/new"
          className={`${actionClass} border-transparent bg-primary text-white hover:bg-primary-hover`}
        >
          {t('dashboard.actions.issue')}
        </Link>
        <Link
          to="/admin/import"
          className={`${actionClass} border-line bg-surface text-ink hover:bg-surface-muted`}
        >
          {t('dashboard.actions.import')}
        </Link>
        <Link
          to="/admin/templates/new"
          className={`${actionClass} border-line bg-surface text-ink hover:bg-surface-muted`}
        >
          {t('dashboard.actions.uploadTemplate')}
        </Link>
      </nav>
      {body}
    </section>
  );
}
