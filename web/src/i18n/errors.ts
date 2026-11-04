import type { TFunction } from 'i18next';

/** API error codes (#16 section 4) plus client-side `NETWORK`. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'GONE',
  'PAYLOAD_TOO_LARGE',
  'TEXT_DOES_NOT_FIT',
  'TEMPLATE_MISMATCH',
  'TEMPLATE_NOT_FOUND',
  'TEMPLATE_INVALID',
  'RATE_LIMITED',
  'INTERNAL',
  'UNAVAILABLE',
  'NETWORK',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

function isKnownCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

/** Key in the `errors` namespace for an API error code; unknown or missing codes use `GENERIC`. */
export function errorMessageKey(code: string | null | undefined): ErrorCode | 'GENERIC' {
  return code && isKnownCode(code) ? code : 'GENERIC';
}

/** Localized message for an API error code with a generic fallback. */
export function errorMessage(t: TFunction, code: string | null | undefined): string {
  return t(`errors:${errorMessageKey(code)}`);
}
