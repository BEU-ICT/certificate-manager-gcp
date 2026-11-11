/** Mirrors `CERTIFICATE_ID_PATTERN` in `api/src/shared/ids.ts`: 22-char base64url or legacy 32 lowercase hex. */
export const CERTIFICATE_ID_PATTERN = /^(?:[A-Za-z0-9_-]{22}|[0-9a-f]{32})$/;

export function isCertificateId(value: string): boolean {
  return CERTIFICATE_ID_PATTERN.test(value);
}

/**
 * Turns whatever a person typed or pasted into a certificate ID, or `null` when it is not one.
 * Trims whitespace; for a pasted URL (or path) the last non-empty path segment is used.
 */
export function parseCertificateInput(input: string): string | null {
  const trimmed = input.trim();
  if (isCertificateId(trimmed)) return trimmed;
  if (!/^(?:https?:\/\/|\/)/i.test(trimmed)) return null;
  let path: string;
  try {
    path = new URL(trimmed, 'http://localhost').pathname;
  } catch {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last === undefined) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    return null;
  }
  return isCertificateId(decoded) ? decoded : null;
}
