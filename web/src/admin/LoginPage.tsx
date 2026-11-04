import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getFirebaseAuth } from '@/auth';

/** Placeholder, the sign-in form is implemented in #73 on top of the `auth` module. */
export default function LoginPage() {
  const { t } = useTranslation('common');
  useEffect(() => {
    // Warm up the SDK only when a Firebase config is present (not in a bare checkout).
    if (import.meta.env.VITE_FIREBASE_API_KEY) getFirebaseAuth();
  }, []);
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">{t('login.title')}</h1>
    </div>
  );
}
