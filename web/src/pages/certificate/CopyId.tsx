import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function CopyId({ id }: { id: string }) {
  const { t } = useTranslation('public');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false); // The ID stays visible and selectable.
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="break-all text-sm">{id}</code>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-line px-3 text-sm font-medium text-primary hover:bg-primary-soft print:hidden"
      >
        {t('certificate.copyId')}
      </button>
      <span role="status" className="text-sm text-ink-muted print:hidden">
        {copied ? t('certificate.copied') : null}
      </span>
    </span>
  );
}
