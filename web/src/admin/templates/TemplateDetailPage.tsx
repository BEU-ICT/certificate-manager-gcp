import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { isApiError } from '@/api';
import { Badge, Button, EmptyState, ErrorState, Skeleton, Spinner } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage } from '@/i18n/language';
import { certificateTypeLabel } from '@/lib/certificateTypes';
import { formatDate, formatNumber } from '@/lib/format';
import { useTemplate } from './api';
import { CopyButton } from './CopyButton';
import { CopyTemplateDialog } from './CopyTemplateDialog';
import { formatBytes } from './format';

const ConfigViewer = lazy(() => import('./ConfigViewer'));

/** `/admin/templates/:reference`: summary, config, files and actions of one template version. */
export default function TemplateDetailPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const { reference = '' } = useParams();
  const query = useTemplate(reference);
  const [copying, setCopying] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const { data } = query;

  const back = (
    <Link to="/admin/templates" className="text-primary underline">
      {t('templates.detail.back')}
    </Link>
  );

  if (query.isError && isApiError(query.error) && query.error.status === 404) {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('templates.detail.notFoundTitle')}
        </h1>
        <EmptyState description={t('templates.detail.notFoundBody')} action={back} />
      </section>
    );
  }
  if (query.isError) {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('templates.detail.title')}
        </h1>
        <ErrorState
          message={errorMessage(t, isApiError(query.error) ? query.error.code : undefined)}
          requestId={isApiError(query.error) ? query.error.requestId : undefined}
          onRetry={() => void query.refetch()}
        />
        {back}
      </section>
    );
  }
  if (!data) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">{t('templates.detail.loading')}</span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const summary: [string, React.ReactNode][] = [
    [t('templates.fields.organization'), data.organizationSlug],
    [t('templates.fields.event'), data.eventSlug],
    [t('templates.fields.type'), certificateTypeLabel(t, data.type)],
    [
      t('templates.columns.version'),
      <span key="v" className="inline-flex items-center gap-2">
        <Badge>{`v${data.version}`}</Badge>
        {data.isLatest ? <Badge tone="success">{t('templates.latest')}</Badge> : null}
      </span>,
    ],
    [t('templates.columns.createdAt'), formatDate(data.createdAt, language)],
    [t('templates.detail.certificateCount'), formatNumber(data.certificateCount, language)],
  ];

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <div>{back}</div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="page-title" className="flex items-center gap-1 text-2xl font-semibold">
          <span className="break-all font-mono">{data.reference}</span>
          <CopyButton
            value={data.reference}
            label={t('templates.copyReference', { reference: data.reference })}
          />
        </h1>
        <div className="flex flex-wrap gap-2">
          {/* Upload form (#315) and preview (#326) are separate tasks: shown disabled until then. */}
          <Button
            variant="secondary"
            disabled
            title={t('templates.uploadSoon')}
            aria-describedby="new-version-soon"
          >
            {t('templates.detail.newVersion')}
          </Button>
          <Button variant="secondary" onClick={() => setCopying(true)}>
            {t('templates.detail.copy')}
          </Button>
          <Button
            variant="secondary"
            disabled
            title={t('templates.previewSoon')}
            aria-describedby="preview-soon"
          >
            {t('templates.detail.preview')}
          </Button>
        </div>
      </div>
      <p id="new-version-soon" className="sr-only">
        {t('templates.uploadSoon')}
      </p>
      <p id="preview-soon" className="sr-only">
        {t('templates.previewSoon')}
      </p>
      <p className="rounded-control bg-surface-muted p-3 text-ink">{t('templates.immutable')}</p>

      <section aria-labelledby="summary-title">
        <h2 id="summary-title" className="mb-2 text-lg font-semibold">
          {t('templates.detail.summary')}
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          {summary.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="font-medium text-ink-muted">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="config-title">
        <h2 id="config-title" className="mb-2 text-lg font-semibold">
          {t('templates.detail.config')}
        </h2>
        <Button
          variant="secondary"
          aria-expanded={showConfig}
          aria-controls="config-body"
          onClick={() => setShowConfig((v) => !v)}
        >
          {showConfig ? t('templates.detail.hideConfig') : t('templates.detail.showConfig')}
        </Button>
        <div id="config-body" className="mt-2">
          {showConfig ? (
            <Suspense fallback={<Spinner />}>
              <ConfigViewer config={data.config} />
            </Suspense>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="files-title">
        <h2 id="files-title" className="mb-2 text-lg font-semibold">
          {t('templates.detail.files')}
        </h2>
        {data.files.length === 0 ? (
          <p className="text-ink-muted">{t('templates.detail.noFiles')}</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            {data.files.map((f) => (
              <li key={f.path} className="flex justify-between gap-4 px-4 py-2">
                <code className="break-all text-sm">{f.path}</code>
                <span className="whitespace-nowrap text-ink-muted">
                  {formatBytes(f.size, language)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {copying ? <CopyTemplateDialog template={data} onClose={() => setCopying(false)} /> : null}
    </section>
  );
}
