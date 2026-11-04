import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * Admin area entry. Route protection and session handling arrive with #73; the admin screens
 * replace the placeholder below.
 */
export default function AdminApp() {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <Routes>
      <Route
        index
        element={
          <main className="mx-auto max-w-xl p-6">
            <h1 className="text-2xl font-semibold">{t('common:admin.title')}</h1>
            <p className="mt-2 text-slate-700">{t('dashboard.intro')}</p>
          </main>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
