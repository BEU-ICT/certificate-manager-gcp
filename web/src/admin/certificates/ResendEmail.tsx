import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api';
import { Button, Dialog, TextField, useToast } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { CERTIFICATES_KEY, refreshCertificate, useResendEmail } from './api';
import { MaskedEmail } from './MaskedEmail';

/** After a successful resend the certificate is polled this many times, this many ms apart. */
export const POLL_ATTEMPTS = 3;
export const POLL_INTERVAL_MS = 5000;
const EMAIL_MAX_LENGTH = 254;

type Form = { email: string };
type Outcome = 'sent' | 'failed' | 'pending';

interface Props {
  id: string;
  /** Stored address, `null` when the certificate has none. */
  email: string | null;
  showButton: boolean;
}

/** "Resend email" button, its dialog (masked address, optional correction) and the status polling. */
export function ResendEmail({ id, email, showButton }: Props) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const formId = useId();
  const resend = useResendEmail(id);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [polls, setPolls] = useState(0);
  const inFlight = useRef(false);
  const hasEmail = email !== null && email !== '';

  const schema = useMemo(
    () =>
      z.object({
        email: hasEmail
          ? z
              .string()
              .trim()
              .max(EMAIL_MAX_LENGTH, t('certificates.detail.resendDialog.invalid'))
              .refine((v) => v === '' || z.email().safeParse(v).success, {
                message: t('certificates.detail.resendDialog.invalid'),
              })
          : z
              .string()
              .trim()
              .min(1, t('certificates.detail.resendDialog.required'))
              .max(EMAIL_MAX_LENGTH, t('certificates.detail.resendDialog.invalid'))
              .pipe(z.email(t('certificates.detail.resendDialog.invalid'))),
      }),
    [t, hasEmail],
  );
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  // Poll the certificate until the e-mail is `sent` or `failed`, at most POLL_ATTEMPTS times.
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        let outcome: Outcome = 'pending';
        try {
          outcome = (await refreshCertificate(queryClient, id)).emailStatus as Outcome;
        } catch {
          // A failed poll counts as an attempt; the next one may succeed.
        }
        if (cancelled) return;
        if (outcome === 'sent' || outcome === 'failed') {
          setPolling(false);
          toast.show(
            outcome === 'sent'
              ? t('certificates.detail.resendDialog.sent')
              : t('certificates.detail.resendDialog.failed'),
            outcome === 'sent' ? 'success' : 'error',
          );
        } else if (polls + 1 >= POLL_ATTEMPTS) {
          setPolling(false);
          toast.show(t('certificates.detail.resendDialog.stillPending'), 'info');
        } else {
          setPolls(polls + 1);
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, polls, queryClient, id, toast, t]);

  function failureMessage(error: unknown): string {
    if (!isApiError(error)) return errorMessage(t, undefined);
    const detail = error.details?.[0]?.message;
    if (error.status === 409 && detail === 'CERTIFICATE_REVOKED')
      return t('certificates.detail.resendDialog.errors.revoked');
    if (error.status === 409 && detail === 'EMAIL_IN_PROGRESS')
      return t('certificates.detail.resendDialog.errors.inProgress');
    if (error.status === 422 && (error.code === 'EMAIL_REQUIRED' || detail === 'EMAIL_REQUIRED'))
      return t('certificates.detail.resendDialog.errors.required');
    if (error.status === 429)
      return error.retryAfterSeconds
        ? t('certificates.detail.resendDialog.errors.rateLimitedRetry', {
            seconds: error.retryAfterSeconds,
          })
        : t('certificates.detail.resendDialog.errors.rateLimited');
    if (error.status === 404) return t('certificates.detail.resendDialog.errors.notFound');
    return errorMessage(t, error.code);
  }

  async function submit(value: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    try {
      await resend.mutateAsync(value ? { email: value } : {});
      toast.show(t('certificates.detail.resendDialog.toast'), 'success');
      setOpen(false);
      reset();
      setPolls(0);
      setPolling(true);
    } catch (error) {
      if (
        isApiError(error) &&
        error.status === 400 &&
        error.details?.some((d) => d.path === 'email')
      ) {
        setError('email', { message: t('certificates.detail.resendDialog.invalid') });
      } else {
        setFailure(failureMessage(error));
        // The page may show stale data (e.g. already revoked or already pending): refresh it.
        const status = isApiError(error) ? error.status : 0;
        // A 503 means the queue refused the task: the certificate is now `failed`.
        if (status === 409 || status === 404 || status === 503)
          void queryClient.invalidateQueries({ queryKey: CERTIFICATES_KEY });
      }
    } finally {
      inFlight.current = false;
    }
  }

  function close() {
    if (resend.isPending) return;
    setOpen(false);
    setFailure(null);
    reset();
  }

  return (
    <>
      {showButton ? (
        <Button
          variant="secondary"
          onClick={() => setOpen(true)}
          loading={polling}
          aria-haspopup="dialog"
        >
          {t('certificates.detail.resend')}
        </Button>
      ) : null}
      <p role="status" className="basis-full text-ink-muted empty:hidden">
        {polling ? t('certificates.detail.emailPolling') : null}
      </p>
      <Dialog
        open={open}
        onClose={close}
        title={t('certificates.detail.resendDialog.title')}
        actions={
          <>
            <Button variant="secondary" onClick={close} disabled={resend.isPending}>
              {t('certificates.detail.resendDialog.cancel')}
            </Button>
            <Button type="submit" form={formId} loading={resend.isPending}>
              {t('certificates.detail.resendDialog.submit')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          onSubmit={(event) => void handleSubmit((v: Form) => submit(v.email.trim()))(event)}
          className="flex flex-col gap-4"
        >
          {failure ? (
            <p role="alert" className="rounded-control bg-danger-soft p-3 font-medium text-danger">
              {failure}
            </p>
          ) : null}
          <p>{t('certificates.detail.resendDialog.intro')}</p>
          <p>
            <span className="font-medium text-ink-muted">
              {t('certificates.detail.resendDialog.current')}:{' '}
            </span>
            {hasEmail ? (
              <MaskedEmail email={email} />
            ) : (
              <span className="text-ink-muted">{t('certificates.detail.resendDialog.none')}</span>
            )}
          </p>
          <TextField
            label={t('certificates.detail.resendDialog.newLabel')}
            type="email"
            autoComplete="off"
            required={!hasEmail}
            hint={
              hasEmail
                ? t('certificates.detail.resendDialog.newOptionalHint')
                : t('certificates.detail.resendDialog.newRequiredHint')
            }
            data-autofocus
            error={errors.email?.message}
            {...register('email')}
          />
        </form>
      </Dialog>
    </>
  );
}
