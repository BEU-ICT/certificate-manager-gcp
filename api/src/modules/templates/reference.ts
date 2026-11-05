import { isCertificateType } from '../../shared/certificate-types.js';
import { ValidationError, type ErrorDetail } from '../../shared/errors.js';
import { TEMPLATE_REF_PATTERN, type TemplateRef } from '../../shared/ids.js';
import { isValidSlug } from '../../shared/slug.js';

/** Longest accepted template reference (#88). */
export const MAX_REFERENCE_LENGTH = 120;

/**
 * Builds `<organizationSlug>-<eventSlug>-<type>-v<version>` from validated parts. Every part is
 * checked and the final value is matched against the reference regex (#16) and the length cap, so
 * a bad combination is rejected here, before any file is written. The reference is never parsed
 * back into its parts.
 */
export function buildTemplateReference(
  organizationSlug: string,
  eventSlug: string,
  type: string,
  version: number,
): TemplateRef {
  const problems: ErrorDetail[] = [];
  if (!isValidSlug(organizationSlug)) {
    problems.push({ path: 'organizationSlug', message: 'Invalid organization slug' });
  }
  if (!isValidSlug(eventSlug)) problems.push({ path: 'eventSlug', message: 'Invalid event slug' });
  if (!isCertificateType(type)) {
    problems.push({ path: 'type', message: 'Unknown certificate type' });
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    problems.push({ path: 'version', message: 'Version must be a non-negative integer' });
  }
  if (problems.length === 0) {
    const reference = `${organizationSlug}-${eventSlug}-${type}-v${String(version)}`;
    if (reference.length <= MAX_REFERENCE_LENGTH && TEMPLATE_REF_PATTERN.test(reference)) {
      return reference as TemplateRef;
    }
    problems.push({
      path: 'reference',
      message: `Reference must match the template reference pattern and be at most ${String(MAX_REFERENCE_LENGTH)} characters`,
    });
  }
  throw new ValidationError('Template reference cannot be built', problems);
}
