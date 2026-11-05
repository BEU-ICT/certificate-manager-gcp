import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';
import { Spinner, ToastProvider } from '@/components';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { AdminLayout } from '@/layouts/AdminLayout';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlaceholderPage } from './PlaceholderPage';
import { useAdminSession } from './session-context';

// Dev-only component gallery. `import.meta.env.DEV` is replaced by `false` in production builds, so
// the dynamic import (and the showcase chunk) is removed entirely from dist.
const ComponentsShowcase = import.meta.env.DEV ? lazy(() => import('./ComponentsShowcase')) : null;

const OrganizationsPage = lazy(() => import('./organizations/OrganizationsPage'));
const EventsPage = lazy(() => import('./events/EventsPage'));

const sections = [
  { path: 'templates', titleKey: 'layout.nav.templates' },
  { path: 'certificates', titleKey: 'layout.nav.certificates' },
  { path: 'import', titleKey: 'layout.nav.import' },
] as const;

function AdminShell() {
  const session = useAdminSession();
  return (
    <AdminLayout
      userEmail={session.email}
      onSignOut={() => void session.signOut().catch(() => undefined)}
      languageSwitcher={<LanguageSwitcher />}
    />
  );
}

/**
 * The admin screens. Loaded as its own chunk by `AdminApp` only after `RequireAdmin` has
 * confirmed the administrator, so nothing in here is fetched for anyone else.
 */
export default function AdminRoutes() {
  const { t } = useTranslation(['common', 'admin']);
  return (
    <ToastProvider>
      <Routes>
        <Route element={<AdminShell />}>
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
          <Route
            path="organizations"
            element={
              <Suspense fallback={<Spinner />}>
                <OrganizationsPage />
              </Suspense>
            }
          />
          <Route
            path="events"
            element={
              <Suspense fallback={<Spinner />}>
                <EventsPage />
              </Suspense>
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
