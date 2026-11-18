import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { completeSignIn } from '@/auth';
import { Spinner } from '@/components';
import { ADMIN_HOME, LOGIN_PATH, safeAdminPath } from './redirect';

/**
 * Redirect URI of the OIDC sign-in: exchanges the authorization code (PKCE) and continues to the
 * validated return path. `RequireAdmin` then confirms the administrator role as for any sign-in.
 */
export default function AuthCallbackPage() {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // The code is single-use: guard against the double effect run in development.
    if (started.current) return;
    started.current = true;
    completeSignIn().then(
      (returnTo) => void navigate(safeAdminPath(returnTo) ?? ADMIN_HOME, { replace: true }),
      () => setFailed(true),
    );
  }, [navigate]);

  if (failed) {
    return (
      <div className="mx-auto w-full max-w-md">
        <p role="alert" className="mb-4 rounded-control bg-danger-soft p-3 font-medium text-danger">
          {t('callback.failed')}
        </p>
        <Link to={LOGIN_PATH} replace className="text-primary underline">
          {t('callback.back')}
        </Link>
      </div>
    );
  }
  return (
    <div role="status" className="mx-auto flex w-full max-w-md items-center gap-3">
      <Spinner />
      <span>{t('callback.working')}</span>
    </div>
  );
}
