import { UnprocessableError, type ErrorDetail } from '../../shared/errors.js';
import { parseTemplateConfig, type TemplateConfig } from './config.js';
import { validateTemplatePackage } from './package-validator.js';
import type { Issue } from './package-issues.js';
import { packageLayoutProblem } from './service.js';

export interface CheckedTemplateUpload {
  config: TemplateConfig;
  /** Advisory findings (config and package) that do not block the upload. */
  warnings: Issue[];
}

const toDetail = (issue: Issue): ErrorDetail => ({
  path: issue.path,
  message: issue.message,
  code: issue.code,
  ...(issue.file !== undefined && { file: issue.file }),
});

/**
 * Everything that decides whether an uploaded package is acceptable, before anything is stored:
 * the config (with the uploaded file list, so missing files are caught), the package validator
 * and the storage layout. `intake` carries findings the transport layer already made (duplicate
 * or reserved file names). Throws `UnprocessableError` `TEMPLATE_INVALID` whose `details` list
 * every finding; returns the parsed config and the warnings otherwise.
 */
export function checkTemplateUpload(
  configInput: unknown,
  files: ReadonlyMap<string, Buffer>,
  intake: readonly Issue[] = [],
): CheckedTemplateUpload {
  const fail = (errors: readonly Issue[]): never => {
    throw new UnprocessableError(
      'TEMPLATE_INVALID',
      'The template package is invalid',
      errors.map(toDetail),
    );
  };

  const parsed = parseTemplateConfig(configInput, { files: [...files.keys()] });
  if (!parsed.ok) return fail([...intake, ...parsed.errors]);

  const report = validateTemplatePackage(files, parsed.config);
  const layout: Issue[] = [];
  for (const name of files.keys()) {
    const problem = packageLayoutProblem(name);
    if (problem !== undefined) {
      layout.push({ code: 'FILENAME_UNSUPPORTED', path: name.slice(0, 100), message: problem });
    }
  }
  const errors = [...intake, ...report.errors, ...layout];
  if (errors.length > 0) return fail(errors);
  return { config: parsed.config, warnings: [...parsed.warnings, ...report.warnings] };
}
