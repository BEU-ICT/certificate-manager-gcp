import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { api, clearApiCache, getAdminMe, isApiError } from '@/api';
import { signOut, useAuth } from '@/auth';
import { ErrorState, Skeleton } from '@/components';
import { errorMessage } from '@/i18n/errors';
import { LOGIN_PATH, type LoginState } from './redirect';
import { AdminSessionContext, type AdminSession } from './session-context';
import { ensureApiAuth, setSessionExpiredHandler } from './session';

/** Why the session ended; decides what `/login` tells the user. */
type Exit = 'signOut' | 'expired' | 'noAccess';

/** Full-page placeholder: nothing of the admin area is rendered while this is shown. */
export function AdminSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-screen flex-col gap-4 bg-surface-muted p-6"
    >
      <span className="sr-only">{t('ui.loading')}</span>
      <Skeleton className="h-12 w-full" />
      <div className="flex flex-1 gap-4">
        <Skeleton className="hidden w-56 md:block" />
        <Skeleton className="h-64 flex-1" />
      </div>
    </div>
  );
}

/**
 * Guards the admin area. Children render only after the SDK reports a signed-in user and
 * `GET /api/v1/admin/me` confirmed the administrator role, so no admin component is loaded and
 * no admin data requested before that. A signed-out visitor is sent to `/login` and brought back
 * afterwards; a non-admin account is signed out; an expired session (second 401) is signed out
 * with a notice. Every end of the session drops the cached API responses.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { status, user } = useAuth();
  const location = useLocation();
  const [exit, setExit] = useState<Exit | null>(null);

  useEffect(() => {
    // Hook for the API client: a 401 that survived the forced token refresh ends the session.
    setSessionExpiredHandler(() => {
      setExit('expired');
      void signOut().catch(() => undefined);
    });
    return () => setSessionExpiredHandler(undefined);
  }, []);

  useEffect(() => {
    // Signed out here, in another tab, or by the SDK: no admin data may stay in memory.
    if (status === 'signedOut') clearApiCache();
  }, [status]);

  const me = useQuery({
    queryKey: ['admin', 'me', user?.uid],
    queryFn: async ({ signal }) => {
      ensureApiAuth();
      try {
        return await getAdminMe(api(), signal);
      } catch (error) {
        if (isApiError(error) && error.status === 403) {
          setExit('noAccess');
          await signOut().catch(() => undefined);
        }
        throw error;
      }
    },
    enabled: status === 'signedIn',
    staleTime: Infinity,
  });

  const handleSignOut = useCallback(async () => {
    setExit('signOut');
    try {
      await signOut();
    } catch (error) {
      setExit(null);
      throw error;
    } finally {
      clearApiCache();
    }
  }, []);

  const session = useMemo<AdminSession | null>(
    () =>
      me.data ? { email: me.data.email, features: me.data.features, signOut: handleSignOut } : null,
    [me.data, handleSignOut],
  );

  if (status === 'signedOut') {
    const from = location.pathname + location.search + location.hash;
    const state: LoginState | undefined =
      exit === 'signOut'
        ? undefined
        : exit === 'noAccess'
          ? { reason: 'noAccess' }
          : exit === 'expired'
            ? { from, reason: 'expired' }
            : { from };
    return <Navigate to={LOGIN_PATH} replace state={state} />;
  }
  if (status === 'signedIn' && session) {
    return <AdminSessionContext value={session}>{children}</AdminSessionContext>;
  }
  if (me.isError && !(isApiError(me.error) && [401, 403].includes(me.error.status))) {
    return (
      <div className="p-6">
        <ErrorState
          message={errorMessage(t, isApiError(me.error) ? me.error.code : undefined)}
          requestId={isApiError(me.error) ? me.error.requestId : undefined}
          onRetry={() => void me.refetch()}
        />
      </div>
    );
  }
  return <AdminSkeleton />;
}
