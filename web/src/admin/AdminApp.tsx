import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';
import { Spinner, ToastProvider } from '@/components';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { AdminLayout } from '@/layouts/AdminLayout';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlaceholderPage } from './PlaceholderPage';

// Dev-only component gallery. `import.meta.env.DEV` is replaced by `false` in production builds, so
// the dynamic import (and the showcase chunk) is removed entirely from dist.
const ComponentsShowcase = import.meta.env.DEV ? lazy(() => import('./ComponentsShowcase')) : null;

const sections = [
  { path: 'organizations', titleKey: 'layout.nav.organizations' },
  { path: 'events', titleKey: 'layout.nav.events' },
  { path: 'templates', titleKey: 'layout.nav.templates' },
  { path: 'certificates', titleKey: 'layout.nav.certificates' },
  { path: 'import', titleKey: 'layout.nav.import' },
] as const;

/**
 * Admin area entry. Route protection, the signed-in user and sign-out arrive with #73 (they become
 * `AdminLayout` props then); the language switcher slot is filled by #39.
 */
export default function AdminApp() {
  const { t } = useTranslation(['common', 'admin']);
  return (
    <ToastProvider>
      <Routes>
        <Route element={<AdminLayout languageSwitcher={<LanguageSwitcher />} />}>
          <Route
            index
            element={
              <section aria-labelledby="page-title">
                <h1 id="page-title" className="text-2xl font-semibold">
                  {t('layout.nav.dashboard')}
                </h1>
                <p className="mt-2 text-ink-muted">{t('admin:dashboard.intro')}</p>
              </section>
            }
          />
          {sections.map((s) => (
            <Route key={s.path} path={s.path} element={<PlaceholderPage titleKey={s.titleKey} />} />
          ))}
          {ComponentsShowcase ? (
            <Route
              path="_components"
              element={
                <Suspense fallback={<Spinner />}>
                  <ComponentsShowcase />
                </Suspense>
              }
            />
          ) : null}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
