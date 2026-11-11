import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, useToast } from '@/components';

const QR_SIZE = 512;

/** Renders `url` as a PNG data URL. The QR library is imported on demand, so only this route loads it. */
async function renderQr(url: string): Promise<string> {
  const qr = await import('qrcode');
  const toDataURL = qr.toDataURL ?? qr.default.toDataURL;
  return toDataURL(url, { width: QR_SIZE, margin: 2, errorCorrectionLevel: 'M' });
}

/** Public URL with a copy button and a client-side QR code that can be downloaded as PNG. */
export function PublicLinkCard({ url, fileName }: { url: string; fileName: string }) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [result, setResult] = useState<{ url: string; dataUrl: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    renderQr(url).then(
      (dataUrl) => {
        if (!cancelled) setResult({ url, dataUrl });
      },
      () => {
        if (!cancelled) setResult({ url, dataUrl: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const current = result?.url === url ? result : null;
  const qr = current?.dataUrl ?? null;
  const failed = current !== null && current.dataUrl === null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.show(t('certificates.detail.copied'), 'success');
    } catch {
      toast.show(t('certificates.detail.copyFailed'), 'error');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <code aria-label={t('certificates.detail.urlLabel')} className="break-all text-sm">
          {url}
        </code>
        <Button variant="secondary" onClick={() => void copy()}>
          {t('certificates.detail.copyUrl')}
        </Button>
      </div>
      <div className="flex flex-col items-start gap-2">
        {qr ? (
          <>
            <img
              src={qr}
              width={192}
              height={192}
              alt={t('certificates.detail.qrAlt', { url })}
              className="rounded-control border border-line bg-white"
            />
            <a
              href={qr}
              download={fileName}
              className="inline-flex min-h-11 items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-base font-medium text-ink hover:bg-surface-muted"
            >
              {t('certificates.detail.qrDownload')}
            </a>
          </>
        ) : failed ? (
          <p role="alert" className="text-danger">
            {t('certificates.detail.qrFailed')}
          </p>
        ) : (
          <div role="status" className="flex items-center gap-2 text-ink-muted">
            <Spinner />
            <span>{t('certificates.detail.qrLoading')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
