import { ValidationError } from '../../shared/errors.js';
import { TEMPLATE_REF_PATTERN, type TemplateRef } from '../../shared/ids.js';
import { MAX_REFERENCE_LENGTH } from './reference.js';
import { packagePathProblem } from './paths.js';

/** Logical bucket of every template object (`StorageGateway` bucketKind). */
export const TEMPLATES_BUCKET = 'templates' as const;

const FILE_NAME = /^[A-Za-z0-9._-]+$/;

function checkedReference(reference: string): TemplateRef {
  if (reference.length > MAX_REFERENCE_LENGTH || !TEMPLATE_REF_PATTERN.test(reference)) {
    throw new ValidationError('Invalid template reference', [
      { path: 'reference', message: 'Does not match the template reference pattern' },
    ]);
  }
  return reference as TemplateRef;
}

function checkedFile(file: string, path: string): string {
  const problem =
    packagePathProblem(file) ??
    (FILE_NAME.test(file) && file !== '.' && file !== '..'
      ? undefined
      : 'Must be a plain file name without directories');
  if (problem !== undefined)
    throw new ValidationError('Invalid file name', [{ path, message: problem }]);
  return file;
}

/** `templates/<reference>/`: the prefix of the whole package, also stored as `storagePath`. */
export function templateStoragePath(reference: string): string {
  return `templates/${checkedReference(reference)}/`;
}

/** Key of a package-relative path (`config.json`, `background.svg`, `fonts/x.ttf`, ...). */
export function templateKey(reference: string, packagePath: string): string {
  const problem = packagePathProblem(packagePath);
  if (problem !== undefined) {
    throw new ValidationError('Invalid package path', [{ path: 'path', message: problem }]);
  }
  return `${templateStoragePath(reference)}${packagePath}`;
}

export const templateConfigKey = (reference: string): string =>
  templateKey(reference, 'config.json');
export const templateBackgroundKey = (reference: string): string =>
  templateKey(reference, 'background.svg');
export const templateFontKey = (reference: string, file: string): string =>
  templateKey(reference, `fonts/${checkedFile(file, 'file')}`);
export const templateAssetKey = (reference: string, file: string): string =>
  templateKey(reference, `assets/${checkedFile(file, 'file')}`);
