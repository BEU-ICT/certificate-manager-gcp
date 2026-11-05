/**
 * Closed registry of certificate types (#16 section 5). Each type is a single lowercase token
 * without hyphens so template references stay readable. Adding a type means adding one entry
 * here and the i18n labels in the frontend.
 */
export const CERTIFICATE_TYPES = [
  'attendance',
  'appreciation',
  'thanks',
  'distinction',
  'instructor',
  'student',
  'team',
  'other',
] as const;

export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

export function isCertificateType(value: unknown): value is CertificateType {
  return typeof value === 'string' && (CERTIFICATE_TYPES as readonly string[]).includes(value);
}
