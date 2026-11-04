import { useTranslation } from 'react-i18next';

/** Placeholder, the real landing page is built in #144. */
export default function LandingPage() {
  const { t } = useTranslation('common');
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
    </main>
  );
}
