import type { components } from './schema';
import { ApiError, INVALID_RESPONSE, NETWORK, TIMEOUT, type ApiErrorDetail } from './errors';

export const API_BASE_PATH = '/api/v1';
export const DEFAULT_TIMEOUT_MS = 30_000;
/** For template upload and preview, which render server-side. */
export const LONG_TIMEOUT_MS = 90_000;

const GENERIC_SERVER_MESSAGE = 'The server could not complete the request.';

/** Returns the current ID token, or null when signed out. `forceRefresh` bypasses the SDK cache. */
export type GetToken = (forceRefresh: boolean) => Promise<string | null>;

export interface ApiClientDeps {
  /** Injected by the auth module (BEU-ICT/certificate-manager#292); the SDK is never imported here. Admin calls only. */
  getToken?: GetToken;
  /** Called after a second consecutive 401 on an admin call (sign-out hook, BEU-ICT/certificate-manager#292). */
  onUnauthorized?: () => void;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialised unless it is a FormData (multipart upload). */
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal | undefined;
  /** Defaults to 30 s; use LONG_TIMEOUT_MS for template upload/preview. */
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDetails(value: unknown): ApiErrorDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ApiErrorDetail[] = [];
  for (const item of value as unknown[]) {
    if (isRecord(item) && typeof item['path'] === 'string' && typeof item['message'] === 'string') {
      const detail: ApiErrorDetail = { path: item['path'], message: item['message'] };
      if (typeof item['suggestion'] === 'string') detail.suggestion = item['suggestion'];
      const counts = item['counts'];
      if (isRecord(counts)) {
        detail.counts = Object.fromEntries(
          Object.entries(counts).filter(([, v]) => typeof v === 'number'),
        ) as Record<string, number>;
      }
      out.push(detail);
    }
  }
  return out;
}

async function toApiError(response: Response): Promise<ApiError> {
  const status = response.status;
  const headerRequestId = response.headers.get('X-Request-Id') ?? undefined;
  const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const err = isRecord(body) && isRecord(body['error']) ? body['error'] : undefined;
  const code =
    typeof err?.['code'] === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(err['code'])
      ? err['code']
      : `HTTP_${status}`;
  const requestId = typeof err?.['requestId'] === 'string' ? err['requestId'] : headerRequestId;
  if (status >= 500) {
    // Never surface raw server text (or details) for 5xx.
    return new ApiError({
      status,
      code,
      message: GENERIC_SERVER_MESSAGE,
      requestId,
      retryAfterSeconds,
    });
  }
  const message =
    typeof err?.['message'] === 'string' ? err['message'] : `Request failed with status ${status}`;
  return new ApiError({
    status,
    code,
    message,
    details: parseDetails(err?.['details']),
    requestId,
    retryAfterSeconds,
  });
}

export interface ApiClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  put<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  patch<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  delete<T = unknown>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
}

export function createApiClient(deps: ApiClientDeps = {}): ApiClient {
  const base = deps.baseUrl ?? API_BASE_PATH;

  async function send(
    path: string,
    options: RequestOptions,
    token: string | null,
  ): Promise<Response> {
    const url = new URL(base + path, globalThis.location.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    let body: BodyInit | null = null;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    try {
      return await fetch(url, { method: options.method ?? 'GET', headers, body, signal });
    } catch (cause) {
      // A caller-initiated abort propagates untouched so TanStack Query can ignore it.
      if (options.signal?.aborted) throw cause;
      if (timeoutSignal.aborted) {
        throw new ApiError({ status: 0, code: TIMEOUT, message: 'The request timed out.' });
      }
      throw new ApiError({ status: 0, code: NETWORK, message: 'Network request failed.' });
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const admin = isAdminPath(path);
    let response = await send(
      path,
      options,
      admin && deps.getToken ? await deps.getToken(false) : null,
    );
    if (response.status === 401 && admin && deps.getToken) {
      // One forced refresh and a single retry; a second 401 means the session is over.
      response = await send(path, options, await deps.getToken(true));
      if (response.status === 401) {
        const error = await toApiError(response);
        deps.onUnauthorized?.();
        throw error;
      }
    }
    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError({
        status: response.status,
        code: INVALID_RESPONSE,
        message: 'The server returned an unreadable response.',
        requestId: response.headers.get('X-Request-Id') ?? undefined,
      });
    }
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  };
}

// --- Typed endpoints (types generated from api/openapi.json by `npm run api:types`) ---

export type Health = components['schemas']['Health'];

export function getHealth(client: ApiClient, signal?: AbortSignal): Promise<Health> {
  return client.get<Health>('/health', { signal });
}

export type AdminMe = components['schemas']['AdminMe'];

/** The signed-in administrator; 401 without a valid token, 403 when the account is not an admin. */
export function getAdminMe(client: ApiClient, signal?: AbortSignal): Promise<AdminMe> {
  return client.get<AdminMe>('/admin/me', { signal });
}
