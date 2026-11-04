import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { RateLimiter, TokenVerifier } from '../../ports/index.js';
import { ForbiddenError, RateLimitedError, UnauthenticatedError } from '../../shared/errors.js';
import { parseBearerToken } from './bearer.js';

export const ADMIN_PREFIX = '/api/v1/admin';
const ADMIN_ROLE = 'admin';
const WINDOW_MS = 60_000;
const DEFAULT_PRE_AUTH_PER_MIN = 60;

/** Identity attached to every request that passed the admin guard. */
export interface AdminPrincipal {
  uid: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the admin guard; present on every handler under `/api/v1/admin`. */
    admin?: AdminPrincipal;
  }
  interface FastifyContextConfig {
    /** Set by {@link adminRoutes}; routes under the admin prefix without it abort startup. */
    adminGuard?: boolean;
  }
}

export interface AdminGuardDeps {
  /** Without a verifier every admin request is rejected (deny by default). */
  tokenVerifier?: TokenVerifier | undefined;
  /** Throttles by client IP before any token is verified. */
  rateLimiter?: RateLimiter | undefined;
  preAuthRequestsPerMin?: number | undefined;
  /** Epoch milliseconds; defaults to `Date.now`. */
  now?: (() => number) | undefined;
}

export interface AdminRouteInfo {
  method: string;
  /** Full URL pattern, e.g. `/api/v1/admin/me`. */
  url: string;
  guarded: boolean;
}

interface GuardState {
  deps: AdminGuardDeps;
  /** Live route options: `config` is marked by adminRoutes() after the root hook has seen the route. */
  routes: { method: string; options: RouteOptions }[];
}

const states = new WeakMap<FastifyInstance, GuardState>();

function stateOf(app: FastifyInstance): GuardState {
  const state = states.get(app);
  if (!state) throw new Error('installAdminGuard() must run on the root instance first');
  return state;
}

const hashIp = (ip: string) => createHash('sha256').update(ip).digest('hex').slice(0, 32);

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: AdminGuardDeps,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const route = request.routeOptions.url ?? '(unmatched)';
  const reject = (reason: string, uid?: string): void => {
    request.log.warn(
      { requestId: request.id, route, reason, ...(uid !== undefined && { uid }) },
      'admin authentication failed',
    );
  };

  if (deps.rateLimiter) {
    const result = await deps.rateLimiter.consume(`admin-auth:ip:${hashIp(request.ip)}`, {
      limit: deps.preAuthRequestsPerMin ?? DEFAULT_PRE_AUTH_PER_MIN,
      windowMs: WINDOW_MS,
    });
    if (!result.allowed) {
      reject('rate-limited');
      throw new RateLimitedError(Math.max(1, Math.ceil((result.resetAt.getTime() - now()) / 1000)));
    }
  }

  let identity;
  try {
    const token = parseBearerToken(request.headers.authorization);
    if (!deps.tokenVerifier) throw new UnauthenticatedError();
    identity = await deps.tokenVerifier.verify(token);
  } catch (error) {
    if (!(error instanceof UnauthenticatedError)) throw error;
    reject('unauthenticated');
    // Same body for every reason; the header names the scheme only.
    reply.header('www-authenticate', 'Bearer');
    throw new UnauthenticatedError();
  }
  if (identity.role !== ADMIN_ROLE) {
    reject('forbidden', identity.uid);
    throw new ForbiddenError();
  }
  request.admin = { uid: identity.uid, email: identity.email };
  request.adminUid = identity.uid;
  request.log.info({ requestId: request.id, route, uid: identity.uid }, 'admin authenticated');
}

/**
 * Installs the admin guard bookkeeping on the root instance (before any route is registered):
 * records every route under `/api/v1/admin` and, once the app is ready, aborts startup when one
 * of them was not registered through {@link adminRoutes}.
 */
export function installAdminGuard(app: FastifyInstance, deps: AdminGuardDeps = {}): void {
  const state: GuardState = { deps, routes: [] };
  states.set(app, state);
  app.decorateRequest('admin');

  app.addHook('onRoute', (route) => {
    if (route.url !== ADMIN_PREFIX && !route.url.startsWith(`${ADMIN_PREFIX}/`)) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) state.routes.push({ method, options: route });
  });

  app.addHook('onReady', () => {
    const unguarded = state.routes.filter((r) => r.options.config?.adminGuard !== true);
    if (unguarded.length > 0) {
      const list = unguarded.map((r) => `${r.method} ${r.options.url}`).join(', ');
      throw new Error(`Admin routes without authentication (use adminRoutes()): ${list}`);
    }
  });
}

/**
 * The only way to register routes under `/api/v1/admin`: paths are relative to the prefix and every
 * route in `register` runs behind the admin guard (401 without a valid token, 403 without
 * `role=admin`).
 */
export function adminRoutes(
  app: FastifyInstance,
  register: (scope: FastifyInstance) => void | Promise<void>,
): void {
  const { deps } = stateOf(app);
  void app.register(
    async (scope) => {
      scope.addHook('onRoute', (route) => {
        route.config = { ...route.config, adminGuard: true };
      });
      scope.addHook('onRequest', (request, reply) => authenticate(request, reply, deps));
      await register(scope);
    },
    { prefix: ADMIN_PREFIX },
  );
}

/** Admin routes registered so far (valid after `app.ready()`), for matrix tests. */
export function listAdminRoutes(app: FastifyInstance): AdminRouteInfo[] {
  return stateOf(app).routes.map((r) => ({
    method: r.method,
    url: r.options.url,
    guarded: r.options.config?.adminGuard === true,
  }));
}
