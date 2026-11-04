import { ValidationError } from './errors.js';

export const NAME_MAX_LENGTH = 120;

/**
 * Display names (organizations, events): trimmed, internal whitespace collapsed to single spaces,
 * 1..120 characters, no control characters. Angle brackets are stored as typed and escaped on output.
 */
export function normalizeName(value: string, path = 'name', max = NAME_MAX_LENGTH): string {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new ValidationError('Invalid name', [
      { path, message: 'Control characters are not allowed' },
    ]);
  }
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > max) {
    throw new ValidationError('Invalid name', [
      { path, message: `Must be 1 to ${String(max)} characters` },
    ]);
  }
  return name;
}
