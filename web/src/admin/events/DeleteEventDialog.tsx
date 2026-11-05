import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api';
import { Button, Dialog, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { inUseCounts, useDeleteEvent, type CertificateEvent, type InUseCounts } from './api';

export function DeleteEventDialog({
  event,
  onClose,
}: {
  event: CertificateEvent;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const remove = useDeleteEvent();
  const [blocked, setBlocked] = useState<InUseCounts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function confirm() {
    setFailure(null);
    try {
      await remove.mutateAsync(event.id);
      toast.show(t('events.toast.deleted', { name: event.name }), 'success');
      onClose();
    } catch (error) {
      const counts = inUseCounts(error);
      if (counts) setBlocked(counts);
      else setFailure(errorMessage(t, isApiError(error) ? error.code : undefined));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('events.delete.title')}
      actions={
        blocked ? (
          <Button variant="secondary" onClick={onClose} data-autofocus>
            {t('events.close')}
          </Button>
        ) : (
          <>
            {/* Initial focus on the safe action. */}
            <Button variant="secondary" onClick={onClose} data-autofocus>
              {t('events.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
              {t('events.delete.confirm')}
            </Button>
          </>
        )
      }
    >
      {failure ? (
        <p role="alert" className="mb-3 rounded-control bg-danger-soft p-3 font-medium text-danger">
          {failure}
        </p>
      ) : null}
      {blocked ? (
        <div role="alert">
          <p>{t('events.delete.blocked', { name: event.name })}</p>
          <ul className="mt-2 list-disc ps-6">
            <li>{t('events.delete.templates', { count: blocked.templates })}</li>
            <li>{t('events.delete.certificates', { count: blocked.certificates })}</li>
          </ul>
          <p className="mt-3 text-ink-muted">{t('events.delete.hint')}</p>
        </div>
      ) : (
        <p>{t('events.delete.message', { name: event.name })}</p>
      )}
    </Dialog>
  );
}
