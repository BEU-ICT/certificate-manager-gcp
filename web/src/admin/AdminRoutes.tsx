import { lazy, Suspense } from 'react';
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

const DashboardPage = lazy(() => import('./dashboard/DashboardPage'));
const OrganizationsPage = lazy(() => import('./organizations/OrganizationsPage'));
const EventsPage = lazy(() => import('./events/EventsPage'));
const TemplatesPage = lazy(() => import('./templates/TemplatesPage'));
const TemplateDetailPage = lazy(() => import('./templates/TemplateDetailPage'));
const TemplateUploadPage = lazy(() => import('./templates/TemplateUploadPage'));
const CertificatesPage = lazy(() => import('./certificates/CertificatesPage'));
const CertificateDetailPage = lazy(() => import('./certificates/CertificateDetailPage'));
const IssueCertificatePage = lazy(() => import('./certificates/IssueCertificatePage'));

const sections = [{ path: 'import', titleKey: 'layout.nav.import' }] as const;

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
  return (
    <ToastProvider>
      <Routes>
        <Route element={<AdminShell />}>
          <Route
            index
            element={
              <Suspense fallback={<Spinner />}>
                <DashboardPage />
              </Suspense>
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
          <Route
            path="templates"
            element={
              <Suspense fallback={<Spinner />}>
                <TemplatesPage />
              </Suspense>
            }
          />
          <Route
            path="templates/new"
            element={
              <Suspense fallback={<Spinner />}>
                <TemplateUploadPage />
              </Suspense>
            }
          />
          <Route
            path="templates/:reference"
            element={
              <Suspense fallback={<Spinner />}>
                <TemplateDetailPage />
              </Suspense>
            }
          />
          <Route
            path="certificates"
            element={
              <Suspense fallback={<Spinner />}>
                <CertificatesPage />
              </Suspense>
            }
          />
          <Route
            path="certificates/new"
            element={
              <Suspense fallback={<Spinner />}>
                <IssueCertificatePage />
              </Suspense>
            }
          />
          <Route
            path="certificates/:id"
            element={
              <Suspense fallback={<Spinner />}>
                <CertificateDetailPage />
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
