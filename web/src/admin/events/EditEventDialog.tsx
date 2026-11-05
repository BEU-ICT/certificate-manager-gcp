import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api';
import { Button, Dialog, Select, TextField, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { useUpdateEvent, type CertificateEvent } from './api';
import { emailLanguageOptions, nameSchema } from './form';

export function EditEventDialog({
  event,
  onClose,
}: {
  event: CertificateEvent;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const formId = useId();
  const update = useUpdateEvent();
  const schema = useMemo(
    () => z.object({ name: nameSchema(t), emailLanguage: z.enum(['az', 'en']) }),
    [t],
  );
  type EditForm = z.infer<typeof schema>;
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: event.name, emailLanguage: event.emailLanguage },
  });

  async function onSubmit(values: EditForm) {
    setFailure(null);
    try {
      const updated = await update.mutateAsync({ id: event.id, ...values });
      toast.show(t('events.toast.updated', { name: updated.name }), 'success');
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, isApiError(error) ? error.code : undefined));
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('events.edit.title')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('events.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={update.isPending}>
            {t('events.edit.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="flex flex-col gap-4"
      >
        {failure ? (
          <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <TextField
          label={t('events.fields.name')}
          required
          autoComplete="off"
          data-autofocus
          error={errors.name?.message}
          {...register('name')}
        />
        <Select
          label={t('events.fields.emailLanguage')}
          required
          placeholder={null}
          options={emailLanguageOptions}
          {...register('emailLanguage')}
        />
        <TextField
          label={t('events.fields.organization')}
          value={event.organizationName}
          readOnly
          hint={t('events.fields.organizationReadOnly')}
        />
        <TextField
          label={t('events.fields.slug')}
          value={event.slug}
          readOnly
          hint={t('events.fields.slugReadOnly')}
        />
      </form>
    </Dialog>
  );
}
