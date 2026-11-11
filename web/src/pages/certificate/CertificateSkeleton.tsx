import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components';

export function CertificateSkeleton() {
  const { t } = useTranslation('public');
  return (
    <section aria-busy="true" className="space-y-4">
      <h1 className="sr-only">{t('certificate.loading')}</h1>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-11 w-48" />
    </section>
  );
}
