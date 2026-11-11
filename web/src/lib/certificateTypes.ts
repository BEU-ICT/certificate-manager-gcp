import type { TFunction } from 'i18next';

/**
 * Closed registry of certificate types. This duplicates `certificate-types.ts` in the API
 * (BEU-ICT/certificate-manager#236 section 5); a shared package is out of scope, keep both lists in sync.
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

/** Localized label; unknown types (for example added on the API first) fall back to the raw id. */
export function certificateTypeLabel(t: TFunction, type: string): string {
  return (CERTIFICATE_TYPES as readonly string[]).includes(type)
    ? t(`common:certificateTypes.${type}`)
    : type;
}
