export interface ApiErrorDetail {
  path: string;
  message: string;
  /** `SLUG_TAKEN`: a free slug proposed by the server. */
  suggestion?: string | undefined;
  /** `IN_USE`: how many records of each kind reference the item. */
  counts?: Record<string, number> | undefined;
  /** `TEMPLATE_INVALID`: stable finding code, e.g. `SVG_SCRIPT`. */
  code?: string | undefined;
  /** `TEMPLATE_INVALID`: the package file the finding belongs to. */
  file?: string | undefined;
}

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: ApiErrorDetail[] | undefined;
  requestId?: string | undefined;
  retryAfterSeconds?: number | undefined;
}

/** Client-side codes (status 0): the request never produced an HTTP response. */
export const NETWORK = 'NETWORK';
export const TIMEOUT = 'TIMEOUT';
export const INVALID_RESPONSE = 'INVALID_RESPONSE';

/**
 * Normalised API failure (BEU-ICT/certificate-manager#236 section 4). `message` is a developer-facing summary; UI code maps
 * `code` to translated text. For 5xx responses it is a fixed string, never raw server text.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[] | undefined;
  readonly requestId: string | undefined;
  /** Parsed `Retry-After` (seconds) on 429/503 responses. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  get isNetwork(): boolean {
    return this.code === NETWORK;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
