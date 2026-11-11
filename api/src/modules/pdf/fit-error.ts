import { UnprocessableError } from '../../shared/errors.js';
import type { FitResult } from './renderer.js';

const TEXT_DOES_NOT_FIT = 'TEXT_DOES_NOT_FIT';
const QR_TOO_SMALL = 'QR_TOO_SMALL';

/**
 * Throws `UnprocessableError` (HTTP 422) listing every misfit as `details[{ path, message }]` when
 * `fit` is not clean. The code is `TEXT_DOES_NOT_FIT`, or `QR_TOO_SMALL` when only the QR code is
 * the problem. Messages contain field names and sizes only, never the certificate text.
 */
export function assertFits(fit: FitResult): void {
  if (fit.fits) return;
  const textIssue = fit.issues.some(
    (i) => i.reason === undefined || i.reason === TEXT_DOES_NOT_FIT,
  );
  throw new UnprocessableError(
    textIssue ? TEXT_DOES_NOT_FIT : QR_TOO_SMALL,
    textIssue ? 'The text does not fit the template' : 'The QR code is too small to print',
    fit.issues.map((i) => ({ path: i.field, message: i.message })),
  );
}
