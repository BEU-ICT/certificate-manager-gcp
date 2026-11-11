import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isGenerationEndpoint, isSafePdfUrl } from './api';

export const PREPARING_MS = 15_000;

/**
 * Plain link to the PDF (no JS fetch: the browser follows the API's redirect). When the link is the
 * generation endpoint the first request renders the PDF, so an inline status is shown for 15 s.
 */
export function DownloadButton({ pdfUrl }: { pdfUrl: string }) {
  const { t } = useTranslation('public');
  const [preparing, setPreparing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!isSafePdfUrl(pdfUrl)) return null;
  const onClick = () => {
    if (!isGenerationEndpoint(pdfUrl)) return;
    setPreparing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPreparing(false), PREPARING_MS);
  };

  return (
    <div className="print:hidden">
      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-transparent bg-primary px-5 py-2 text-base font-medium text-white hover:bg-primary-hover sm:w-auto"
      >
        {t('certificate.download')}
        <span className="sr-only"> {t('certificate.opensInNewTab')}</span>
      </a>
      <p role="status" className="mt-2 text-sm text-ink-muted">
        {preparing ? t('certificate.preparing') : null}
      </p>
    </div>
  );
}
