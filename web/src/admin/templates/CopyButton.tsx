import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, useToast } from '@/components';

/** Copies `value` to the clipboard; reports the result in a toast. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function copy() {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(value);
      toast.show(t('templates.copied'), 'success');
    } catch {
      toast.show(t('templates.copyFailed'), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="ghost" aria-label={label} disabled={busy} onClick={() => void copy()}>
      {t('templates.copyLabel')}
    </Button>
  );
}
