import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { isAuthError, preloadAuth, sendPasswordReset } from '@/auth';
import { Button, TextField } from '@/components';
import { errorMessage } from '@/i18n/errors';

/**
 * Asks for the administrator's email and sends Firebase's reset email. The confirmation is the
 * same whether or not the address belongs to an account, so the page cannot be used to probe for
 * administrators.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation(['admin', 'errors']);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  const confirmationRef = useRef<HTMLParagraphElement>(null);
  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, t('admin:login.errors.emailRequired'))
          .pipe(z.email(t('admin:login.errors.emailInvalid'))),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    preloadAuth();
  }, []);
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);
  useEffect(() => {
    if (sent) confirmationRef.current?.focus();
  }, [sent]);

  async function onSubmit({ email }: { email: string }) {
    setFailure(null);
    setSending(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (error) {
      const kind = isAuthError(error) ? error.kind : 'unknown';
      setFailure(
        kind === 'tooManyRequests'
          ? t('admin:login.errors.tooManyRequests')
          : kind === 'network'
            ? t('admin:login.errors.network')
            : errorMessage(t, undefined),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="mb-4 text-2xl font-semibold">{t('admin:forgot.title')}</h1>
      {sent ? (
        <div className="flex flex-col gap-4">
          <p
            ref={confirmationRef}
            role="status"
            tabIndex={-1}
            className="rounded-control bg-surface-muted p-3 text-ink"
          >
            {t('admin:forgot.sent')}
          </p>
          <Link to="/login" className="self-start text-primary underline">
            {t('admin:forgot.back')}
          </Link>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <p className="text-ink-muted">{t('admin:forgot.intro')}</p>
          {failure ? (
            <p
              ref={failureRef}
              role="alert"
              tabIndex={-1}
              className="rounded-control bg-danger-soft p-3 font-medium text-danger"
            >
              {failure}
            </p>
          ) : null}
          <TextField
            label={t('admin:login.email')}
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" loading={sending}>
            {t('admin:forgot.submit')}
          </Button>
          <Link to="/login" className="self-start text-primary underline">
            {t('admin:forgot.back')}
          </Link>
        </form>
      )}
    </div>
  );
}
