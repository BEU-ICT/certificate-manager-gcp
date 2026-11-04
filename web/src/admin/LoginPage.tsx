import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { preloadAuth } from '@/auth';

/** Placeholder, the sign-in form is implemented in #72 on top of the `auth` module. */
export default function LoginPage() {
  const { t } = useTranslation('common');
  useEffect(() => {
    // Fetch the SDK chunk while the user types; a missing configuration is ignored here.
    preloadAuth();
  }, []);
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">{t('login.title')}</h1>
    </div>
  );
}
