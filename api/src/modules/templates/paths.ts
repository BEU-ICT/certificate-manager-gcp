/** Maximum length of a package-relative path. */
export const MAX_PATH_LENGTH = 100;

const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * Why `value` is not an acceptable package path, or `undefined` when it is. Paths are relative,
 * normalised (no empty, `.` or `..` segments), ASCII `[A-Za-z0-9._/-]`, no backslash, no leading
 * slash and at most 100 characters. Checked before any storage key is built from a path.
 */
export function packagePathProblem(value: string): string | undefined {
  if (value.length === 0) return 'Path must not be empty';
  if (value.length > MAX_PATH_LENGTH) {
    return `Path must be at most ${String(MAX_PATH_LENGTH)} characters`;
  }
  if (value.includes('\\')) return 'Path must not contain backslashes';
  if (value.startsWith('/')) return 'Path must be relative (no leading slash)';
  if (!SAFE_PATH.test(value)) {
    return 'Path may only contain A-Z a-z 0-9 . _ - and single / separators';
  }
  if (value.split('/').some((segment) => segment === '.' || segment === '..')) {
    return 'Path must be normalised (no "." or ".." segments)';
  }
  return undefined;
}

export function isSafePackagePath(value: string): boolean {
  return packagePathProblem(value) === undefined;
}
