import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { ToastContext, type ToastApi, type ToastTone } from './toast-context';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const tones: Record<ToastTone, string> = {
  info: 'border-primary',
  success: 'border-success',
  error: 'border-danger',
};

/** Renders toasts in a polite live region (errors use `role="alert"`). Auto-dismiss after 6 s. */
export function ToastProvider({
  children,
  durationMs = 6000,
}: {
  children: ReactNode;
  durationMs?: number;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((i) => i.id !== id));
  }, []);
  const show = useCallback<ToastApi['show']>(
    (message, tone = 'info') => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss, durationMs],
  );
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label={t('ui.toast.region')}
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:items-end"
      >
        {items.map((i) => (
          <div
            key={i.id}
            role={i.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-control border-l-4 bg-surface p-3 text-sm text-ink shadow-overlay',
              tones[i.tone],
            )}
          >
            <p className="flex-1">{i.message}</p>
            <button
              type="button"
              onClick={() => dismiss(i.id)}
              aria-label={t('ui.toast.dismiss')}
              className="-m-2 inline-flex size-11 items-center justify-center rounded-control text-ink-muted hover:bg-surface-muted"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
