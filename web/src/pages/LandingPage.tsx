import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

/** Placeholder, the real landing page is built in #144. */
export default function LandingPage() {
  const { t } = useTranslation(['public', 'common']);
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{t('common:app.name')}</h1>
      <p className="mt-2 text-slate-700">{t('landing.intro')}</p>
      <LanguageSwitcher className="mt-4 block" />
    </main>
  );
}
