import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  const { t } = useTranslation('common');
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="mt-2 text-slate-700">{t('notFound.body')}</p>
      <Link to="/" className="mt-4 inline-block text-blue-700 underline">
        {t('notFound.home')}
      </Link>
    </div>
  );
}
