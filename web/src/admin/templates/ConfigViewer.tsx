import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';

/** Pretty-printed, read-only JSON. Loaded lazily so the detail page stays small. */
export default function ConfigViewer({ config }: { config: unknown }) {
  const { t } = useTranslation('admin');
  const text = useMemo(() => JSON.stringify(config, null, 2), [config]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <CopyButton value={text} label={t('templates.detail.copyConfig')} />
      </div>
      <pre
        tabIndex={0}
        aria-label={t('templates.detail.configLabel')}
        className="max-h-96 overflow-auto rounded-control border border-line bg-surface-muted p-4 text-sm"
      >
        <code>{text}</code>
      </pre>
    </div>
  );
}
