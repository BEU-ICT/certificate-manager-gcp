import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * Admin area entry. Route protection and session handling arrive with #73; the admin screens
 * replace the placeholder below.
 */
export default function AdminApp() {
  const { t } = useTranslation('common');
  return (
    <Routes>
      <Route
        index
        element={
          <main className="mx-auto max-w-xl p-6">
            <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
          </main>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
