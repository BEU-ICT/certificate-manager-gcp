import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

/** Placeholder, the real certificate page is built in #143. */
export default function CertificatePage() {
  const { t } = useTranslation('common');
  const { id } = useParams();
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{t('certificate.title')}</h1>
      <p className="mt-2 break-all text-slate-700">{id}</p>
    </main>
  );
}
