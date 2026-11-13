import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { fakeToken } from '../../src/testing/fakes/index.js';
import type { AdminRouteCase } from '../../src/testing/admin-routes.js';

/**
 * Helpers of the authorisation matrix (BEU-ICT/certificate-manager#398): pure functions that
 * report violations as strings, so the suite can also prove (self-test) that an unprotected
 * route would be caught.
 */

export interface RouteRef {
  method: string;
  url: string;
}

export const routeKey = (r: RouteRef): string => `${r.method} ${r.url}`;

// ---------------------------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------------------------

/**
 * Every registered `METHOD url` pair of the app, parsed from `printRoutes()` (HEAD and OPTIONS
 * dropped). Used for the public and internal prefixes, whose routes are not tracked by the admin
 * guard; the radix tree prints shared prefixes once, so the full path is rebuilt from the depth.
 */
export function listAllRoutes(app: FastifyInstance): RouteRef[] {
  const stack: string[] = [];
  const found: RouteRef[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^([│ ]*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?$/u.exec(line);
    if (!match) continue;
    const depth = (match[1] ?? '').length / 4;
    stack.length = depth;
    stack[depth] = match[2] ?? '';
    for (const method of (match[3] ?? '').split(', ').filter(Boolean)) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      found.push({ method, url: stack.join('') });
    }
  }
  return found;
}

export const routesUnder = (routes: RouteRef[], prefix: string): RouteRef[] =>
  routes.filter((r) => r.url === prefix || r.url.startsWith(`${prefix}/`));

// ---------------------------------------------------------------------------------------------
// Admin matrix
// ---------------------------------------------------------------------------------------------

export const ADMIN_TOKEN = fakeToken('matrix-admin', 'admin');
export const NON_ADMIN_TOKEN = fakeToken('matrix-user');
/** Registered with the fake verifier and then revoked, so it is well-formed but no longer valid. */
export const EXPIRED_TOKEN = 'matrix-expired-token';

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Authorization headers that must all answer 401, each with a label for failure messages. */
export const UNAUTHENTICATED_HEADERS: [string, Record<string, string>][] = [
  ['no token', {}],
  ['empty bearer', { authorization: 'Bearer' }],
  ['wrong scheme', { authorization: 'Basic YWRtaW46YWRtaW4=' }],
  ['malformed token', bearer('not.a.jwt')],
  ['garbage token', bearer('x'.repeat(2048))],
  ['expired token', bearer(EXPIRED_TOKEN)],
];

type Inject = (opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  payload?: string;
}) => Promise<{ statusCode: number }>;

/** Minimal invalid JSON body for methods that carry one: validation fails, nothing is written. */
const bodyOptions = (method: string): { payload?: string; contentType?: string } =>
  ['POST', 'PUT', 'PATCH'].includes(method)
    ? { payload: '{}', contentType: 'application/json' }
    : {};

/**
 * Sends the four requests of the matrix to one admin route and returns what is wrong:
 * (a)/(b) 401 without a valid token, (c) 403 for a user without the admin claim, (d) neither
 * 401 nor 403 for an admin.
 */
export async function checkAdminRoute(inject: Inject, route: AdminRouteCase): Promise<string[]> {
  const violations: string[] = [];
  const send = (headers: Record<string, string>) => {
    const { payload, contentType } = bodyOptions(route.method);
    return inject({
      method: route.method,
      url: route.concreteUrl,
      headers: { ...headers, ...(contentType && { 'content-type': contentType }) },
      ...(payload !== undefined && { payload }),
    });
  };
  const label = routeKey(route);
  for (const [name, headers] of UNAUTHENTICATED_HEADERS) {
    const res = await send(headers);
    if (res.statusCode !== 401) violations.push(`${label}: ${name} -> ${res.statusCode}, want 401`);
  }
  const nonAdmin = await send(bearer(NON_ADMIN_TOKEN));
  if (nonAdmin.statusCode !== 403) {
    violations.push(`${label}: user without admin claim -> ${nonAdmin.statusCode}, want 403`);
  }
  const admin = await send(bearer(ADMIN_TOKEN));
  if (admin.statusCode === 401 || admin.statusCode === 403) {
    violations.push(`${label}: admin token -> ${admin.statusCode}, want neither 401 nor 403`);
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------
// Happy-path coverage registry
// ---------------------------------------------------------------------------------------------

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Admin routes with an explicit happy-path test: key to the test file. The file must carry the
 * line `// happy-path: METHOD url` for that exact route, so a new route in an existing module
 * fails until its test is tagged. A new admin route must add its entry here (and the tag), otherwise `authz-matrix.test.ts` fails. Keys are `METHOD url` exactly as
 * Fastify registered them.
 */
export const ROUTES_WITH_HAPPY_PATH_TEST: Record<string, string> = {
  'GET /api/v1/admin/me': 'test/unit/admin-me.test.ts',
  'POST /api/v1/admin/organizations': 'test/helpers/organizations-api-suite.ts',
  'GET /api/v1/admin/organizations': 'test/helpers/organizations-api-suite.ts',
  'GET /api/v1/admin/organizations/:id': 'test/helpers/organizations-api-suite.ts',
  'PATCH /api/v1/admin/organizations/:id': 'test/helpers/organizations-api-suite.ts',
  'DELETE /api/v1/admin/organizations/:id': 'test/helpers/organizations-api-suite.ts',
  'POST /api/v1/admin/events': 'test/helpers/events-api-suite.ts',
  'GET /api/v1/admin/events': 'test/helpers/events-api-suite.ts',
  'GET /api/v1/admin/events/:id': 'test/helpers/events-api-suite.ts',
  'PATCH /api/v1/admin/events/:id': 'test/helpers/events-api-suite.ts',
  'DELETE /api/v1/admin/events/:id': 'test/helpers/events-api-suite.ts',
  'POST /api/v1/admin/templates': 'test/helpers/template-upload-suite.ts',
  'POST /api/v1/admin/templates/:reference/copy': 'test/helpers/template-copy-suite.ts',
  'POST /api/v1/admin/templates/:reference/preview': 'test/helpers/template-preview-suite.ts',
  'GET /api/v1/admin/templates': 'test/helpers/templates-api-suite.ts',
  'GET /api/v1/admin/templates/:reference': 'test/helpers/templates-api-suite.ts',
  'GET /api/v1/admin/certificates': 'test/helpers/certificates-api-suite.ts',
  'GET /api/v1/admin/certificates/count': 'test/helpers/certificates-api-suite.ts',
  'GET /api/v1/admin/certificates/:id': 'test/helpers/certificates-api-suite.ts',
  'POST /api/v1/admin/certificates/:id/revoke': 'test/helpers/certificate-revocation-api-suite.ts',
  'POST /api/v1/admin/certificates/:id/resend-email':
    'test/unit/admin-certificate-resend-email.test.ts',
  'POST /api/v1/admin/certificates': 'test/helpers/certificate-issuance-api-suite.ts',
  'POST /api/v1/admin/certificates/bulk': 'test/helpers/certificate-bulk-issuance-api-suite.ts',
  'GET /api/v1/admin/stats': 'test/unit/admin-stats.test.ts',
};

/**
 * Problems with the registry for the given routes: a route with no entry, an entry whose file is
 * missing or lacks the route's `// happy-path:` tag, and entries for routes that no longer exist.
 */
export function checkHappyPathRegistry(
  routes: RouteRef[],
  registry: Record<string, string>,
  read: (file: string) => string | undefined = readApiFile,
): string[] {
  const problems: string[] = [];
  const keys = new Set(routes.map(routeKey));
  for (const key of keys) {
    const file = registry[key];
    if (!file) {
      problems.push(`${key}: no happy-path test registered in ROUTES_WITH_HAPPY_PATH_TEST`);
      continue;
    }
    const content = read(file);
    if (content === undefined) problems.push(`${key}: ${file} does not exist`);
    else if (!content.includes(`happy-path: ${key}\n`)) {
      problems.push(`${key}: ${file} has no "// happy-path: ${key}" tag`);
    }
  }
  for (const key of Object.keys(registry)) {
    if (!keys.has(key)) problems.push(`${key}: registered but the route does not exist`);
  }
  return problems;
}

function readApiFile(file: string): string | undefined {
  const path = `${API_ROOT}${file}`;
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

// ---------------------------------------------------------------------------------------------
// Public response scan
// ---------------------------------------------------------------------------------------------

/** Property names that must never appear in a public body (compared case-insensitively). */
export const FORBIDDEN_PUBLIC_KEYS = [
  'email',
  'pdfPath',
  'createdBy',
  'emailStatus',
  'emailAttempts',
  'emailSentAt',
  'emailLastError',
  'revokeReason',
  'revokedAt',
  'revokedBy',
  'templateId',
  'organizationId',
  'eventId',
  'schemaVersion',
];

const EMAIL_SHAPE = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/u;
const PDF_OBJECT = /(^|[^a-z])pdfs\//iu;

/**
 * Forbidden keys and patterns anywhere in a parsed JSON value: a forbidden property name, an
 * email-shaped string, or a `pdfs/` object name in any property other than `pdfUrl`.
 */
export function findPublicLeaks(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') {
    return EMAIL_SHAPE.test(value) ? [`${path}: email-shaped string`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => findPublicLeaks(v, `${path}[${i}]`));
  if (typeof value !== 'object' || value === null) return [];
  const leaks: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const here = `${path}.${key}`;
    if (FORBIDDEN_PUBLIC_KEYS.some((k) => k.toLowerCase() === key.toLowerCase())) {
      leaks.push(`${here}: forbidden key`);
    }
    if (key !== 'pdfUrl' && typeof child === 'string' && PDF_OBJECT.test(child)) {
      leaks.push(`${here}: storage object name outside pdfUrl`);
    }
    leaks.push(...findPublicLeaks(child, here));
  }
  return leaks;
}
