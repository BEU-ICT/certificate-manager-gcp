import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api';
import { Button, Checkbox, Dialog, TextArea, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { useRevokeCertificate } from './api';

export const REASON_MAX_LENGTH = 500;

type Form = { reason: string; understood: boolean };

/** Revoke button, its confirm dialog and (after a PDF cleanup failure) the retry warning. */
export function RevokeCertificate({ id, showButton }: { id: string; showButton: boolean }) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const formId = useId();
  const revoke = useRevokeCertificate(id);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pdfWarning, setPdfWarning] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const pendingFocus = useRef(false);
  const warningRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef('');
  const inFlight = useRef(false);
  const schema = useMemo(
    () =>
      z.object({
        reason: z
          .string()
          .trim()
          .min(1, t('certificates.detail.revokeDialog.reasonRequired'))
          .max(
            REASON_MAX_LENGTH,
            t('certificates.detail.revokeDialog.reasonTooLong', { max: REASON_MAX_LENGTH }),
          ),
        understood: z
          .boolean()
          .refine((v) => v, { message: t('certificates.detail.revokeDialog.understandRequired') }),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isValid },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { reason: '', understood: false },
  });
  const reasonValue = useWatch({ control, name: 'reason' }) ?? '';

  // The trigger (or the retry button) disappears after a success: move focus to a stable element.
  useEffect(() => {
    if (!pendingFocus.current || open || (showButton && !pdfWarning)) return;
    pendingFocus.current = false;
    (warningRef.current ?? document.getElementById('page-title'))?.focus();
  });

  async function submit(reason: string, fromDialog: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    try {
      const result = await revoke.mutateAsync({ reason });
      reasonRef.current = reason;
      const failed = result.warnings?.includes('PDF_DELETE_FAILED') ?? false;
      setPdfWarning(failed);
      setRetryFailed(!fromDialog && failed);
      if (fromDialog) toast.show(t('certificates.detail.revokeDialog.toast'), 'success');
      else if (!failed) toast.show(t('certificates.detail.pdfWarning.done'), 'success');
      pendingFocus.current = true;
      if (fromDialog) {
        setOpen(false);
        reset();
      }
    } catch (error) {
      setFailure(
        isApiError(error) && error.status === 404
          ? t('certificates.detail.revokeDialog.notFound')
          : errorMessage(t, isApiError(error) ? error.code : undefined),
      );
    } finally {
      inFlight.current = false;
    }
  }

  function close() {
    if (revoke.isPending) return;
    setOpen(false);
    setFailure(null);
    reset();
  }

  return (
    <>
      {showButton ? (
        <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
          {t('certificates.detail.revoke')}
        </Button>
      ) : null}
      {pdfWarning ? (
        <div
          ref={warningRef}
          tabIndex={-1}
          role="alert"
          className="basis-full rounded-card border border-warning bg-warning-soft p-4"
        >
          <p className="font-semibold text-ink">{t('certificates.detail.pdfWarning.title')}</p>
          <p className="mt-1 text-ink">{t('certificates.detail.pdfWarning.body')}</p>
          {retryFailed ? (
            <p className="mt-2 font-medium text-danger">
              {t('certificates.detail.pdfWarning.stillFailed')}
            </p>
          ) : null}
          {failure ? <p className="mt-2 font-medium text-danger">{failure}</p> : null}
          <Button
            className="mt-3"
            variant="secondary"
            loading={revoke.isPending}
            onClick={() => void submit(reasonRef.current, false)}
          >
            {t('certificates.detail.pdfWarning.retry')}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={open}
        onClose={close}
        title={t('certificates.detail.revokeDialog.title')}
        actions={
          <>
            <Button variant="secondary" onClick={close} disabled={revoke.isPending}>
              {t('certificates.detail.revokeDialog.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="danger"
              loading={revoke.isPending}
              disabled={!isValid}
            >
              {t('certificates.detail.revokeDialog.submit')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          onSubmit={(event) => void handleSubmit((v: Form) => submit(v.reason.trim(), true))(event)}
          className="flex flex-col gap-4"
        >
          {failure ? (
            <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
              {failure}
            </p>
          ) : null}
          <p>{t('certificates.detail.revokeDialog.consequences')}</p>
          <div>
            <TextArea
              label={t('certificates.detail.revokeDialog.reasonLabel')}
              hint={`${t('certificates.detail.revokeDialog.reasonHint')} ${t(
                'certificates.detail.revokeDialog.counter',
                { count: reasonValue.length, max: REASON_MAX_LENGTH },
              )}`}
              required
              data-autofocus
              error={errors.reason?.message}
              {...register('reason')}
            />
          </div>
          <Checkbox
            label={t('certificates.detail.revokeDialog.understand')}
            {...(errors.understood?.message ? { error: errors.understood.message } : {})}
            {...register('understood')}
          />
        </form>
      </Dialog>
    </>
  );
}
