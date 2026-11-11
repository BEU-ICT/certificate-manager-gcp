/** Name Cloud Error Reporting groups the errors under. */
export const SERVICE_NAME = 'certificates-api';

export const REPORTED_ERROR_EVENT_TYPE =
  'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';

export interface ServiceContext {
  service: string;
  /** Git SHA (build arg `GIT_SHA`) or the Cloud Run revision (`K_REVISION`). */
  version: string;
}

/** `GIT_SHA` (baked in at build time) wins over `K_REVISION`; `unknown` when neither is set. */
export function serviceVersion(env: Readonly<Record<string, string | undefined>>): string {
  return env['GIT_SHA'] || env['K_REVISION'] || 'unknown';
}

/** Minimal logger shape, satisfied by pino and Fastify loggers. */
export interface ErrorLogger {
  error: (obj: object, msg: string) => void;
  fatal: (obj: object, msg: string) => void;
}

/** Stack trace of anything thrown; Error Reporting needs it in `message` to group occurrences. */
export function stackOf(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return `Non-error thrown: ${typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error))}`;
}

/**
 * Logs an unexpected error in the Error Reporting format: `@type` marks the entry as a
 * ReportedErrorEvent, the stack trace is the `message`, and the logger's `serviceContext`
 * (added to every ERROR/CRITICAL line by `createLogger`) names service and version.
 * Stacks go to the logs only, never into responses.
 */
export function logUnexpectedError(
  log: ErrorLogger,
  error: unknown,
  fields: Record<string, unknown> = {},
  level: 'error' | 'fatal' = 'error',
): void {
  log[level]({ '@type': REPORTED_ERROR_EVENT_TYPE, ...fields, err: error }, stackOf(error));
}
