import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

/** Placeholder, the real certificate page is built in #143. */
export default function CertificatePage() {
  const { t } = useTranslation(['public', 'common']);
  const { id } = useParams();
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">{t('common:certificate.title')}</h1>
      <p className="mt-2 break-all text-slate-700">{id}</p>
    </div>
  );
}
