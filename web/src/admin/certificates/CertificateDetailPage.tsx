import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { isApiError } from '@/api';
import { Badge, EmptyState, ErrorState, Skeleton, type BadgeTone } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { DEFAULT_LANGUAGE, isLanguage } from '@/i18n/language';
import { certificateTypeLabel } from '@/lib/certificateTypes';
import { isCertificateId } from '@/lib/certificateId';
import { formatDate, formatNumber } from '@/lib/format';
import { useCertificate, type CertificateDetail } from './api';
import { emailErrorMessage } from './email-error';
import { EmailStatusBadge } from './EmailStatusBadge';
import { MaskedEmail } from './MaskedEmail';
import { ResendEmail } from './ResendEmail';
import { RevokeCertificate } from './RevokeCertificate';
import { PublicLinkCard } from './PublicLinkCard';

const STATUS_TONE: Record<CertificateDetail['status'], BadgeTone> = {
  active: 'success',
  revoked: 'danger',
};

const linkButton =
  'inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-base font-medium text-ink hover:bg-surface-muted';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface p-4">
      <h2 id={id} className="mb-2 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-medium text-ink-muted">{term}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** `/admin/certificates/:id`: every field of one certificate and its actions. */
export default function CertificateDetailPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const language = isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
  const { id = '' } = useParams();
  const wellFormed = isCertificateId(id);
  const query = useCertificate(id, wellFormed);
  const { data } = query;

  const back = (
    <Link to="/admin/certificates" className="text-primary underline">
      {t('certificates.detail.back')}
    </Link>
  );

  if (!wellFormed || (query.isError && isApiError(query.error) && query.error.status === 404)) {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('certificates.detail.notFoundTitle')}
        </h1>
        <EmptyState description={t('certificates.detail.notFoundBody')} action={back} />
      </section>
    );
  }
  if (query.isError) {
    return (
      <section aria-labelledby="page-title" className="flex flex-col gap-4">
        <h1 id="page-title" className="text-2xl font-semibold">
          {t('certificates.detail.title')}
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
        <span className="sr-only">{t('certificates.detail.loading')}</span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const none = t('certificates.detail.notAvailable');
  const date = (value: string | null) => (value ? formatDate(value, language) : none);
  const revoked = data.status === 'revoked';
  // The public route is `c/:id` (web/src/router.tsx); built here rather than taken from `publicUrl`
  // so the link always points at the origin the admin is using.
  const publicPath = `/c/${encodeURIComponent(data.id)}`;
  const publicUrl = `${window.location.origin}${publicPath}`;

  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-6">
      <div>{back}</div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold">
          {data.ownerName}
        </h1>
        <div className="flex flex-wrap gap-2">
          <a href={publicPath} target="_blank" rel="noopener noreferrer" className={linkButton}>
            {t('certificates.detail.openPublic')}
            <span className="sr-only"> ({t('certificates.detail.newTab')})</span>
          </a>
          <RevokeCertificate id={data.id} showButton={!revoked} />
          <ResendEmail id={data.id} email={data.email} showButton={!revoked} />
        </div>
      </div>

      <Section id="recipient-title" title={t('certificates.detail.recipient')}>
        <Fields
          rows={[
            [t('certificates.detail.fields.name'), data.ownerName],
            [
              t('certificates.detail.fields.email'),
              data.email ? (
                <MaskedEmail email={data.email} />
              ) : (
                <span className="text-ink-muted">{t('certificates.detail.fields.noEmail')}</span>
              ),
            ],
            [t('certificates.detail.fields.subject'), data.subject],
            [
              t('certificates.detail.fields.skills'),
              data.skills.length > 0 ? (
                <ul className="flex flex-wrap gap-1">
                  {data.skills.map((skill) => (
                    <li key={skill}>
                      <Badge>{skill}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-ink-muted">{t('certificates.detail.fields.noSkills')}</span>
              ),
            ],
          ]}
        />
      </Section>

      <Section id="issuance-title" title={t('certificates.detail.issuance')}>
        <Fields
          rows={[
            [t('certificates.detail.fields.organization'), data.organizationName],
            [t('certificates.detail.fields.event'), data.eventName],
            [t('certificates.detail.fields.type'), certificateTypeLabel(t, data.type)],
            [
              t('certificates.detail.fields.template'),
              <Link
                key="tpl"
                to={`/admin/templates/${encodeURIComponent(data.templateId)}`}
                className="font-mono text-primary underline"
              >
                {data.templateId}
              </Link>,
            ],
            [t('certificates.detail.fields.issuedAt'), date(data.issuedAt)],
            [t('certificates.detail.fields.createdAt'), date(data.createdAt)],
            [t('certificates.detail.fields.createdBy'), data.createdBy],
            [t('certificates.detail.fields.id'), <code key="id">{data.id}</code>],
          ]}
        />
      </Section>

      <Section id="status-title" title={t('certificates.detail.status')}>
        <Fields
          rows={[
            [
              t('certificates.detail.status'),
              <Badge key="s" tone={STATUS_TONE[data.status]}>
                {t(`certificates.status.${data.status}`)}
              </Badge>,
            ],
            ...(revoked
              ? ([
                  [t('certificates.detail.fields.revokedAt'), date(data.revokedAt)],
                  [
                    t('certificates.detail.fields.revokeReason'),
                    data.revokeReason ?? (
                      <span className="text-ink-muted">
                        {t('certificates.detail.fields.noReason')}
                      </span>
                    ),
                  ],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
      </Section>

      <Section id="pdf-title" title={t('certificates.detail.pdf')}>
        <Fields
          rows={[
            [
              t('certificates.detail.fields.pdfGenerated'),
              data.pdfGeneratedAt ? t('certificates.detail.yes') : t('certificates.detail.no'),
            ],
            [t('certificates.detail.fields.pdfGeneratedAt'), date(data.pdfGeneratedAt)],
            [
              t('certificates.detail.fields.pdfLink'),
              data.pdfUrl ? (
                <a
                  href={data.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  {t('certificates.detail.openPdf')}
                </a>
              ) : (
                none
              ),
            ],
          ]}
        />
      </Section>

      <Section id="email-title" title={t('certificates.detail.email')}>
        <Fields
          rows={[
            [
              t('certificates.detail.fields.emailStatus'),
              <EmailStatusBadge key="e" status={data.emailStatus} />,
            ],
            [
              t('certificates.detail.fields.emailAttempts'),
              formatNumber(data.emailAttempts, language),
            ],
            [
              t('certificates.detail.fields.emailLastError'),
              data.emailLastError ? emailErrorMessage(t, data.emailLastError) : none,
            ],
            [t('certificates.detail.fields.emailSentAt'), date(data.emailSentAt)],
          ]}
        />
      </Section>

      <Section id="public-title" title={t('certificates.detail.publicLink')}>
        <PublicLinkCard url={publicUrl} fileName={`certificate-${data.id}.png`} />
      </Section>
    </section>
  );
}
