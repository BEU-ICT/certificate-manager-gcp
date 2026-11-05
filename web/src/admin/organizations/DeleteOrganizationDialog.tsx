import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api';
import { Button, Dialog, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { inUseCounts, useDeleteOrganization, type InUseCounts, type Organization } from './api';

export function DeleteOrganizationDialog({
  organization,
  onClose,
}: {
  organization: Organization;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const remove = useDeleteOrganization();
  const [blocked, setBlocked] = useState<InUseCounts | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function confirm() {
    setFailure(null);
    try {
      await remove.mutateAsync(organization.id);
      toast.show(t('organizations.toast.deleted', { name: organization.name }), 'success');
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
      title={t('organizations.delete.title')}
      actions={
        blocked ? (
          <Button variant="secondary" onClick={onClose} data-autofocus>
            {t('organizations.close')}
          </Button>
        ) : (
          <>
            {/* Initial focus on the safe action. */}
            <Button variant="secondary" onClick={onClose} data-autofocus>
              {t('organizations.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
              {t('organizations.delete.confirm')}
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
          <p>{t('organizations.delete.blocked', { name: organization.name })}</p>
          <ul className="mt-2 list-disc ps-6">
            <li>{t('organizations.delete.events', { count: blocked.events })}</li>
            <li>{t('organizations.delete.templates', { count: blocked.templates })}</li>
            <li>{t('organizations.delete.certificates', { count: blocked.certificates })}</li>
          </ul>
          <p className="mt-3 text-ink-muted">{t('organizations.delete.hint')}</p>
        </div>
      ) : (
        <p>{t('organizations.delete.message', { name: organization.name })}</p>
      )}
    </Dialog>
  );
}
