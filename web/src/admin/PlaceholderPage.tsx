import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components';

/** Stand-in for admin screens that are built in later tasks. */
export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-4 text-2xl font-semibold">
        {t(titleKey)}
      </h1>
      <EmptyState description={t('layout.admin.comingSoon')} />
    </section>
  );
}
