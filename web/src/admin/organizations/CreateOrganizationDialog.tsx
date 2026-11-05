import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api';
import { Button, Dialog, TextField, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { isValidSlug, slugify, SLUG_MAX_LENGTH } from '@/lib/slug';
import { slugTaken, useCreateOrganization } from './api';

export const NAME_MAX_LENGTH = 120;

function createSchema(t: TFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('organizations.errors.nameRequired'))
      .max(NAME_MAX_LENGTH, t('organizations.errors.nameTooLong', { max: NAME_MAX_LENGTH })),
    slug: z
      .string()
      .trim()
      .min(1, t('organizations.errors.slugRequired'))
      .refine(isValidSlug, t('organizations.errors.slugInvalid', { max: SLUG_MAX_LENGTH })),
  });
}
type CreateForm = z.infer<ReturnType<typeof createSchema>>;

/** Mounted only while open, so the form starts empty every time. */
export function CreateOrganizationDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const formId = useId();
  const create = useCreateOrganization();
  const schema = useMemo(() => createSchema(t), [t]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The slug follows the name until the user types in the slug field.
  const [slugEdited, setSlugEdited] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<CreateForm>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', slug: '' },
  });

  const nameField = register('name', {
    onChange: (event: { target: { value: string } }) => {
      if (!slugEdited) setValue('slug', slugify(event.target.value));
      setSuggestion(null);
    },
  });
  const slugField = register('slug', {
    onChange: () => {
      setSlugEdited(true);
      setSuggestion(null);
    },
  });

  async function onSubmit(values: CreateForm) {
    setFailure(null);
    try {
      const created = await create.mutateAsync(values);
      toast.show(t('organizations.toast.created', { name: created.name }), 'success');
      onClose();
    } catch (error) {
      const taken = slugTaken(error);
      if (taken) {
        setError('slug', { type: 'server', message: t('organizations.errors.slugTaken') });
        setSuggestion(taken.suggestion ?? null);
      } else {
        setFailure(errorMessage(t, isApiError(error) ? error.code : undefined));
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('organizations.create.title')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('organizations.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            {t('organizations.create.submit')}
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
          {...nameField}
        />
        <div>
          <TextField
            label={t('organizations.fields.slug')}
            required
            autoComplete="off"
            spellCheck={false}
            hint={t('organizations.fields.slugHint')}
            error={errors.slug?.message}
            {...slugField}
          />
          {suggestion ? (
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => {
                setSlugEdited(true);
                setValue('slug', suggestion);
                clearErrors('slug');
                setSuggestion(null);
              }}
            >
              {t('organizations.errors.useSuggestion', { slug: suggestion })}
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
