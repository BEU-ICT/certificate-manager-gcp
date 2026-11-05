import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api';
import { Button, Dialog, TextField, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { useRenameOrganization, type Organization } from './api';
import { NAME_MAX_LENGTH } from './CreateOrganizationDialog';

function createSchema(t: TFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('organizations.errors.nameRequired'))
      .max(NAME_MAX_LENGTH, t('organizations.errors.nameTooLong', { max: NAME_MAX_LENGTH })),
  });
}
type RenameForm = z.infer<ReturnType<typeof createSchema>>;

export function RenameOrganizationDialog({
  organization,
  onClose,
}: {
  organization: Organization;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const formId = useId();
  const rename = useRenameOrganization();
  const schema = useMemo(() => createSchema(t), [t]);
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RenameForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: organization.name },
  });

  async function onSubmit({ name }: RenameForm) {
    setFailure(null);
    try {
      const updated = await rename.mutateAsync({ id: organization.id, name });
      toast.show(t('organizations.toast.renamed', { name: updated.name }), 'success');
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, isApiError(error) ? error.code : undefined));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('organizations.rename.title')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('organizations.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={rename.isPending}>
            {t('organizations.rename.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
      >
        {failure ? (
          <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <TextField
          label={t('organizations.fields.name')}
          required
          autoComplete="off"
          data-autofocus
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label={t('organizations.fields.slug')}
          value={organization.slug}
          readOnly
          hint={t('organizations.fields.slugReadOnly')}
        />
      </form>
    </Dialog>
  );
}
