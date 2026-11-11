import { logUnexpectedError, type ErrorLogger } from './http/logging/error-reporting.js';

interface ProcessLike {
  on(
    event: 'unhandledRejection' | 'uncaughtException',
    listener: (reason: unknown) => void,
  ): unknown;
}

/**
 * Crash-only semantics: an unhandled rejection or uncaught exception leaves the process in an
 * unknown state, so log it as CRITICAL (Error Reporting format, with the revision so a crash loop
 * is attributable) and exit(1); Cloud Run starts a fresh instance.
 */
export function installProcessSafety(
  proc: ProcessLike,
  log: ErrorLogger,
  options: { revision: string; exit?: (code: number) => void },
): void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let crashing = false;
  const crash = (origin: 'unhandledRejection' | 'uncaughtException') => (reason: unknown) => {
    if (!crashing) {
      crashing = true;
      try {
        logUnexpectedError(log, reason, { origin, revision: options.revision }, 'fatal');
      } finally {
        exit(1);
      }
    }
  };
  proc.on('unhandledRejection', crash('unhandledRejection'));
  proc.on('uncaughtException', crash('uncaughtException'));
}
