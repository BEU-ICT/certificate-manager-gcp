import type { FastifyInstance } from 'fastify';
import { listAdminRoutes, type AdminRouteInfo } from '../http/auth/admin-guard.js';

export interface AdminRouteCase extends AdminRouteInfo {
  /** `url` with path parameters replaced by a placeholder, ready for `app.inject`. */
  concreteUrl: string;
}

/**
 * Calls `fn` for every route under `/api/v1/admin` of a ready app, so an authorisation matrix
 * (no token, malformed header, non-admin, admin) covers new routes without being edited.
 * Fails when the app has no admin route, because an empty matrix would pass vacuously.
 */
export async function forEachAdminRoute(
  app: FastifyInstance,
  fn: (route: AdminRouteCase) => Promise<void> | void,
): Promise<void> {
  await app.ready();
  const routes = listAdminRoutes(app).filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS');
  if (routes.length === 0) throw new Error('forEachAdminRoute: the app has no admin routes');
  for (const route of routes) {
    await fn({ ...route, concreteUrl: route.url.replace(/:[A-Za-z0-9_]+/g, 'x') });
  }
}
