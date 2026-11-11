import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { isApiError } from '@/api';
import { Button, Dialog, Select, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { CERTIFICATE_TYPES, certificateTypeLabel } from '@/lib/certificateTypes';
import { OrganizationSelect } from '../events/OrganizationSelect';
import { copyFieldErrors, useCopyTemplate, type TemplateDetail } from './api';
import { EventSelect } from './EventSelect';

/** Copies a template version into another event (and optionally another type). Mounted while open. */
export function CopyTemplateDialog({
  template,
  onClose,
}: {
  template: TemplateDetail;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const navigate = useNavigate();
  const formId = useId();
  const copy = useCopyTemplate(template.reference);
  const [organizationId, setOrganizationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [type, setType] = useState('');
  const [errors, setErrors] = useState<{
    organizationId?: string | undefined;
    eventId?: string | undefined;
    type?: string | undefined;
  }>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function submit() {
    const next: typeof errors = {};
    if (!organizationId)
      next.organizationId = t('admin:templates.copy.errors.organizationRequired');
    if (!eventId) next.eventId = t('admin:templates.copy.errors.eventRequired');
    setErrors(next);
    setFailure(null);
    if (next.organizationId || next.eventId) return;
    try {
      const created = await copy.mutateAsync({
        organizationId,
        eventId,
        ...(type ? { type } : {}),
      });
      toast.show(t('admin:templates.copy.toast', { reference: created.reference }), 'success');
      onClose();
      void navigate(`/admin/templates/${encodeURIComponent(created.reference)}`);
    } catch (error) {
      const paths = copyFieldErrors(error);
      if (paths.size > 0) {
        const invalid = t('admin:templates.copy.errors.invalid');
        setErrors({
          ...(paths.has('organizationId') ? { organizationId: invalid } : {}),
          ...(paths.has('eventId')
            ? { eventId: t('admin:templates.copy.errors.eventMismatch') }
            : {}),
          ...(paths.has('type') ? { type: invalid } : {}),
        });
      }
      if (isApiError(error) && error.status === 422) {
        setFailure(t('admin:templates.copy.errors.rejected'));
      } else {
        setFailure(errorMessage(t, isApiError(error) ? error.code : undefined));
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin:templates.copy.title')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('admin:events.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={copy.isPending}>
            {t('admin:templates.copy.submit')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
      >
        <p className="text-ink-muted">
          {t('admin:templates.copy.intro', { reference: template.reference })}
        </p>
        {failure ? (
          <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
            {failure}
          </p>
        ) : null}
        <OrganizationSelect
          label={t('admin:templates.fields.organization')}
          placeholder={t('admin:events.fields.organizationPlaceholder')}
          required
          autoFocus
          value={organizationId}
          error={errors.organizationId}
          onChange={(value) => {
            setOrganizationId(value);
            setEventId('');
            setErrors({});
          }}
        />
        <EventSelect
          label={t('admin:templates.fields.event')}
          placeholder={t('admin:templates.fields.eventPlaceholder')}
          required
          organizationId={organizationId}
          value={eventId}
          error={errors.eventId}
          onChange={(value) => {
            setEventId(value);
            setErrors((e) => ({ ...e, eventId: undefined }));
          }}
        />
        <Select
          label={t('admin:templates.fields.type')}
          placeholder={t('admin:templates.copy.sameType', {
            type: certificateTypeLabel(t, template.type),
          })}
          hint={t('admin:templates.copy.typeHint')}
          {...(errors.type ? { error: errors.type } : {})}
          value={type}
          options={CERTIFICATE_TYPES.map((c) => ({
            value: c,
            label: t(`common:certificateTypes.${c}`),
          }))}
          onChange={(event) => setType(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
