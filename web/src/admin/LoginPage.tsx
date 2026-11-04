import { zodResolver } from '@hookform/resolvers/zod';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, getAdminMe, isApiError } from '@/api';
import { isAuthError, preloadAuth, signIn, signOut, useAuth, type AuthErrorKind } from '@/auth';
import { Button, TextField } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { PasswordField } from './PasswordField';
import { loginReason, loginTarget } from './redirect';
import { ensureApiAuth } from './session';

function createSchema(t: TFunction) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t('admin:login.errors.emailRequired'))
      .pipe(z.email(t('admin:login.errors.emailInvalid'))),
    password: z.string().min(1, t('admin:login.errors.passwordRequired')),
  });
}
type LoginForm = z.infer<ReturnType<typeof createSchema>>;

function signInMessage(t: TFunction, kind: AuthErrorKind): string {
  switch (kind) {
    case 'invalidCredentials':
      return t('admin:login.errors.invalidCredentials');
    case 'tooManyRequests':
      return t('admin:login.errors.tooManyRequests');
    case 'network':
      return t('admin:login.errors.network');
    case 'disabled':
      return t('admin:login.errors.disabled');
    case 'unknown':
      return errorMessage(t, undefined);
  }
}

/** `leaving`: signed in at the SDK but rejected by the API, waiting for the sign-out to land. */
type Phase = 'idle' | 'working' | 'leaving';

/**
 * Administrator sign-in. There is deliberately no registration entry point. After the SDK sign-in
 * the API confirms the admin role (`GET /api/v1/admin/me`); anything but a 200 signs out again.
 */
export default function LoginPage() {
  const { t } = useTranslation(['admin', 'errors']);
  const { status } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  const schema = useMemo(() => createSchema(t), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // While the SDK still reports the rejected account as signed in, the form stays busy.
  const busy = phase === 'working' || (phase === 'leaving' && status !== 'signedOut');
  const target = loginTarget(location.state, location.search);
  const reason = loginReason(location.state);

  useEffect(() => {
    // Fetch the SDK chunk while the user types; a missing configuration is ignored here.
    preloadAuth();
  }, []);

  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  async function rejectAccount(message: string) {
    setPhase('leaving');
    setFailure(message);
    try {
      await signOut();
    } catch {
      setPhase('idle');
    }
  }

  async function onSubmit({ email, password }: LoginForm) {
    setFailure(null);
    setPhase('working');
    try {
      await signIn(email, password);
    } catch (error) {
      setFailure(signInMessage(t, isAuthError(error) ? error.kind : 'unknown'));
      setPhase('idle');
      return;
    }
    ensureApiAuth();
    try {
      await getAdminMe(api());
    } catch (error) {
      if (isApiError(error) && error.status === 403) {
        await rejectAccount(t('admin:login.errors.noAccess'));
      } else if (isApiError(error) && error.status === 401) {
        await rejectAccount(errorMessage(t, 'GENERIC'));
      } else {
        await rejectAccount(errorMessage(t, isApiError(error) ? error.code : undefined));
      }
      return;
    }
    void navigate(target, { replace: true });
  }

  if (status === 'signedIn' && !busy) return <Navigate to={target} replace />;

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="mb-4 text-2xl font-semibold">{t('admin:login.title')}</h1>
      {reason === 'expired' ? (
        <p role="status" className="mb-4 rounded-control bg-surface-muted p-3 text-ink">
          {t('admin:login.sessionExpired')}
        </p>
      ) : null}
      {reason === 'noAccess' && !failure ? (
        <p role="alert" className="mb-4 rounded-control bg-danger-soft p-3 text-danger">
          {t('admin:login.errors.noAccess')}
        </p>
      ) : null}
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
      >
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
        <PasswordField
          label={t('admin:login.password')}
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" loading={busy}>
          {t('admin:login.submit')}
        </Button>
        <Link to="/login/forgot-password" className="self-start text-primary underline">
          {t('admin:login.forgot')}
        </Link>
      </form>
    </div>
  );
}
