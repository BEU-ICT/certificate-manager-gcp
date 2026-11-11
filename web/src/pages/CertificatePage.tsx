import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { isApiError } from '@/api';
import { Button } from '@/components';
import { isLanguage } from '@/i18n/language';
import { certificateTypeLabel } from '@/lib/certificateTypes';
import { formatDateLong } from '@/lib/format';
import { usePublicCertificate, type PublicCertificate } from './certificate/api';
import { CertificateSkeleton } from './certificate/CertificateSkeleton';
import { CopyId } from './certificate/CopyId';
import { DownloadButton } from './certificate/DownloadButton';
import { DEFAULT_RETRY_SECONDS, RateLimited } from './certificate/RateLimited';
import { StateCard } from './certificate/StateCard';

function StatusIcon({ revoked }: { revoked: boolean }) {
  return (
    <svg
      className="size-7 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {revoked ? (
        <>
          <path d="M12 3 2 21h20L12 3Z" />
          <path d="M12 10v5M12 18h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}
    </svg>
  );
}

function CertificateDetails({ certificate }: { certificate: PublicCertificate }) {
  const { t, i18n } = useTranslation(['public', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'az';
  const revoked = certificate.status === 'revoked';
  const rows: Array<[string, React.ReactNode]> = [
    [t('public:certificate.organization'), certificate.organizationName],
    [t('public:certificate.event'), certificate.eventName],
    [t('public:certificate.type'), certificateTypeLabel(t, certificate.type)],
    [t('public:certificate.subject'), certificate.subject],
    [
      t('public:certificate.skills'),
      certificate.skills.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {certificate.skills.map((skill, index) => (
            <li
              key={`${skill}-${index}`}
              className="rounded-full border border-line bg-surface-muted px-3 py-1 text-sm"
            >
              {skill}
            </li>
          ))}
        </ul>
      ) : (
        '—'
      ),
    ],
    [t('public:certificate.issuedAt'), formatDateLong(certificate.issuedAt, language)],
    [t('public:certificate.id'), <CopyId key="id" id={certificate.id} />],
  ];

  return (
    <article className="space-y-6">
      <div
        className={`flex items-center gap-3 rounded-card border px-4 py-3 text-lg font-semibold ${
          revoked
            ? 'border-warning bg-warning-soft text-warning'
            : 'border-success bg-success-soft text-success'
        }`}
      >
        <StatusIcon revoked={revoked} />
        <p aria-live="polite">
          {revoked ? t('public:certificate.revoked') : t('public:certificate.valid')}
        </p>
      </div>
      {revoked ? <p className="text-base">{t('public:certificate.revokedNote')}</p> : null}
      <h1 className="break-words text-3xl font-bold sm:text-4xl">{certificate.ownerName}</h1>
      <dl className="grid gap-4 sm:grid-cols-[max-content_1fr] sm:gap-x-8">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-medium text-ink-muted">{label}</dt>
            <dd className="break-words text-base">{value}</dd>
          </div>
        ))}
      </dl>
      {!revoked && certificate.pdfUrl ? <DownloadButton pdfUrl={certificate.pdfUrl} /> : null}
    </article>
  );
}

export default function CertificatePage() {
  const { t, i18n } = useTranslation(['public', 'common']);
  const { id = '' } = useParams();
  const query = usePublicCertificate(id);
  const [searchParams, setSearchParams] = useSearchParams();

  // Keep `?lang=` in step with the language switcher so a shared link opens in the same language.
  const language = i18n.resolvedLanguage;
  useEffect(() => {
    if (isLanguage(language) && searchParams.get('lang') !== language) {
      const next = new URLSearchParams(searchParams);
      next.set('lang', language);
      setSearchParams(next, { replace: true });
    }
  }, [language, searchParams, setSearchParams]);

  // The title never contains the person's name.
  const organization = query.data?.organizationName;
  useEffect(() => {
    const previous = document.title;
    document.title = organization
      ? t('public:certificate.documentTitle', { organization })
      : t('public:certificate.documentTitleGeneric');
    return () => {
      document.title = previous;
    };
  }, [organization, t, language]);

  let content: React.ReactNode;
  if (query.isPending) {
    content = <CertificateSkeleton />;
  } else if (query.isError) {
    const error = query.error;
    if (isApiError(error) && error.status === 404) {
      content = (
        <StateCard title={t('public:certificate.notFound.title')}>
          <p aria-live="polite">{t('public:certificate.notFound.message')}</p>
        </StateCard>
      );
    } else if (isApiError(error) && error.status === 429) {
      content = (
        <RateLimited
          key={query.errorUpdatedAt}
          seconds={error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS}
          onRetry={() => void query.refetch()}
        />
      );
    } else {
      const offline = isApiError(error) && error.status === 0;
      content = (
        <StateCard title={t('public:certificate.error.title')} tone="danger">
          <p aria-live="polite">
            {offline
              ? t('public:certificate.error.offline')
              : t('public:certificate.error.generic')}
          </p>
          {isApiError(error) && error.requestId ? (
            <p className="break-all text-sm text-ink-muted">
              <code>{t('common:ui.error.requestId', { id: error.requestId })}</code>
            </p>
          ) : null}
          <Button
            variant="secondary"
            className="print:hidden"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('common:ui.error.retry')}
          </Button>
        </StateCard>
      );
    }
  } else {
    content = <CertificateDetails certificate={query.data} />;
  }

  return <div className="mx-auto max-w-2xl">{content}</div>;
}
