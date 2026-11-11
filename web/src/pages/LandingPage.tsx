import { useTranslation } from 'react-i18next';

/** Placeholder, the real landing page is built in BEU-ICT/certificate-manager#363. */
export default function LandingPage() {
  const { t } = useTranslation(['public', 'common']);
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">{t('common:app.name')}</h1>
      <p className="mt-2 text-slate-700">{t('landing.intro')}</p>
    </div>
  );
}
