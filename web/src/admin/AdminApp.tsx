import { lazy, Suspense } from 'react';
import { AdminSkeleton, RequireAdmin } from './RequireAdmin';

// The screens are a separate chunk, requested only once the administrator is confirmed.
const AdminRoutes = lazy(() => import('./AdminRoutes'));

/** Admin area entry: the access gate first, the admin screens behind it. */
export default function AdminApp() {
  return (
    <RequireAdmin>
      <Suspense fallback={<AdminSkeleton />}>
        <AdminRoutes />
      </Suspense>
    </RequireAdmin>
  );
}
