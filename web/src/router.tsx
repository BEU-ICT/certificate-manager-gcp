import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from '@/layouts/RootLayout';
import { NoIndex } from '@/lib/NoIndex';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Route-level code splitting: the root chunk holds only the router, the layout and the 404 page.
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const CertificatePage = lazy(() => import('@/pages/CertificatePage'));
const LoginPage = lazy(() => import('@/admin/LoginPage'));
const AdminApp = lazy(() => import('@/admin/AdminApp'));

const fallback = (
  <p role="status" className="p-6 text-slate-600">
    …
  </p>
);

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={fallback}>
            <LandingPage />
          </Suspense>
        ),
      },
      {
        path: 'c/:id',
        element: (
          <Suspense fallback={fallback}>
            <NoIndex />
            <CertificatePage />
          </Suspense>
        ),
      },
      {
        path: 'login',
        element: (
          <Suspense fallback={fallback}>
            <NoIndex />
            <LoginPage />
          </Suspense>
        ),
      },
      {
        path: 'admin/*',
        element: (
          <Suspense fallback={fallback}>
            <NoIndex />
            <AdminApp />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
