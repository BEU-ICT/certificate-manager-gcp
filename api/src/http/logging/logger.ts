import {
  pino,
  stdSerializers,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from 'pino';

export interface LogOptions {
  /** pino level; `silent` disables output. */
  level?: string | undefined;
  /** When set, trace correlation fields are added to request logs. */
  gcpProject?: string | undefined;
  /** Output stream; defaults to stdout (Cloud Run forwards it to Cloud Logging). */
  destination?: DestinationStream | undefined;
}

/** pino level -> Cloud Logging severity. */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

const SECRET_KEYS = ['email', 'token', 'password', 'apiKey', 'ownerName'];
const MAX_REDACT_DEPTH = 4;

/**
 * Redaction paths: the two sensitive headers plus every secret key at the top
 * level and up to `MAX_REDACT_DEPTH` levels deep (a pino wildcard matches one level).
 */
export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  ...SECRET_KEYS.flatMap((key) =>
    Array.from({ length: MAX_REDACT_DEPTH }, (_, depth) =>
      [...Array<string>(depth).fill('*'), key].join('.'),
    ),
  ),
];

export function createLogger(options: LogOptions = {}): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    messageKey: 'message',
    base: null, // no pid / hostname noise
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`, // RFC3339 (UTC)
    formatters: {
      level: (label) => ({ severity: SEVERITY[label] ?? 'DEFAULT' }),
    },
    serializers: { err: stdSerializers.err },
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
