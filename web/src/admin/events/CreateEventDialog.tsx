import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useId, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api';
import { Button, Dialog, Select, TextField, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { isValidSlug, slugify, SLUG_MAX_LENGTH } from '@/lib/slug';
import { organizationMissing, slugTaken, useCreateEvent } from './api';
import { emailLanguageOptions, nameSchema } from './form';
import { OrganizationSelect } from './OrganizationSelect';

function createSchema(t: TFunction) {
  return z.object({
    organizationId: z.string().min(1, t('events.errors.organizationRequired')),
    name: nameSchema(t),
    slug: z
      .string()
      .trim()
      .min(1, t('events.errors.slugRequired'))
      .refine(isValidSlug, t('events.errors.slugInvalid', { max: SLUG_MAX_LENGTH })),
    emailLanguage: z.enum(['az', 'en']),
  });
}
type CreateForm = z.infer<ReturnType<typeof createSchema>>;

/** Mounted only while open, so the form starts empty every time. `organizationId` preselects. */
export function CreateEventDialog({
  organizationId,
  onClose,
}: {
  organizationId?: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const formId = useId();
  const create = useCreateEvent();
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
    control,
    formState: { errors },
  } = useForm<CreateForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      organizationId: organizationId ?? '',
      name: '',
      slug: '',
      emailLanguage: 'az',
    },
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
  // A taken slug is per organization: another organization may be free.
  const orgValue = useWatch({ control, name: 'organizationId' });

  async function onSubmit(values: CreateForm) {
    setFailure(null);
    try {
      const created = await create.mutateAsync(values);
      toast.show(t('events.toast.created', { name: created.name }), 'success');
      onClose();
    } catch (error) {
      const taken = slugTaken(error);
      if (taken) {
        setError('slug', { type: 'server', message: t('events.errors.slugTaken') });
        setSuggestion(taken.suggestion ?? null);
      } else if (organizationMissing(error)) {
        setError('organizationId', {
          type: 'server',
          message: t('events.errors.organizationGone'),
        });
      } else {
        setFailure(errorMessage(t, isApiError(error) ? error.code : undefined));
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('events.create.title')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('events.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            {t('events.create.submit')}
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
        <OrganizationSelect
          label={t('events.fields.organization')}
          placeholder={t('events.fields.organizationPlaceholder')}
          required
          autoFocus
          value={orgValue}
          error={errors.organizationId?.message}
          onChange={(value) => {
            setValue('organizationId', value, { shouldValidate: Boolean(errors.organizationId) });
            setSuggestion(null);
            clearErrors('slug');
          }}
        />
        <TextField
          label={t('events.fields.name')}
          required
          autoComplete="off"
          error={errors.name?.message}
          {...nameField}
        />
        <div>
          <TextField
            label={t('events.fields.slug')}
            required
            autoComplete="off"
            spellCheck={false}
            hint={t('events.fields.slugHint')}
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
              {t('events.errors.useSuggestion', { slug: suggestion })}
            </Button>
          ) : null}
        </div>
        <Select
          label={t('events.fields.emailLanguage')}
          required
          placeholder={null}
          hint={t('events.fields.emailLanguageHint')}
          options={emailLanguageOptions}
          {...register('emailLanguage')}
        />
      </form>
    </Dialog>
  );
}
