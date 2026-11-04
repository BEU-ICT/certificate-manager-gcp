import { z } from 'zod';

/**
 * Typed, fail-fast configuration (twelve-factor). `loadConfig` is a pure function of its input:
 * it never reads `process.env` itself; the composition root (server.ts) passes the environment in.
 *
 * Error messages are built from variable names and fixed texts only. Values are never echoed, so
 * secrets (EMAIL_API_KEY, ...) cannot leak through validation errors.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const DB_ADAPTERS = ['firestore', 'memory'] as const;
export const STORAGE_ADAPTERS = ['gcs', 'fs', 'memory'] as const;
export const QUEUE_ADAPTERS = ['cloud-tasks', 'in-process'] as const;
export const AUTH_PROVIDERS = ['firebase'] as const;
export const EMAIL_PROVIDERS = ['gmail', 'brevo'] as const;

export interface Flags {
  /** Serve the OpenAPI document. Default: off in production, on elsewhere. */
  readonly openApiEndpoint: boolean;
  /** Run the bounce-processing job. Default: off. */
  readonly bounceJob: boolean;
  /** Fall back to EMAIL_FALLBACK_PROVIDER when the primary fails. Default: on. */
  readonly emailFallback: boolean;
  /** Allow bulk issuance. Default: on. */
  readonly bulkIssuance: boolean;
  /** Kill switch for on-demand public PDF generation. Default: on. */
  readonly publicPdfGeneration: boolean;
}

export interface Config {
  readonly env: (typeof NODE_ENVS)[number];
  readonly port: number;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly gcpProject: string;
  readonly serviceUrl: string;
  readonly publicBaseUrl: string;
  readonly pdfPublicBaseUrl: string;
  readonly storage: {
    readonly templatesBucket: string | undefined;
    readonly pdfBucket: string | undefined;
  };
  readonly tasks: {
    readonly queue: string | undefined;
    readonly location: string | undefined;
    readonly invokerServiceAccount: string | undefined;
  };
  readonly bootstrapAdminEmail: string;
  readonly email: {
    readonly provider: (typeof EMAIL_PROVIDERS)[number];
    readonly fallbackProvider: (typeof EMAIL_PROVIDERS)[number] | undefined;
    /** Secret. Never log. */
    readonly apiKey: string | undefined;
    readonly fromAddress: string;
    readonly fromName: string;
    readonly replyTo: string | undefined;
    readonly dailyCap: number;
  };
  readonly rateLimit: {
    readonly publicPerMin: number;
    readonly adminPerMin: number;
  };
  readonly adapters: {
    readonly db: (typeof DB_ADAPTERS)[number];
    readonly storage: (typeof STORAGE_ADAPTERS)[number];
    readonly queue: (typeof QUEUE_ADAPTERS)[number];
    readonly auth: (typeof AUTH_PROVIDERS)[number];
  };
  readonly flags: Flags;
}

export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(ConfigError.format(issues));
    this.name = 'ConfigError';
    this.issues = issues;
  }

  static format(issues: readonly ConfigIssue[]): string {
    const lines = issues.map((i) => `  - ${i.variable}: ${i.message}`);
    return `Invalid configuration (${issues.length} problem${issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
  }
}

type Env = Record<string, string | undefined>;

/** Local-development defaults (emulators / in-memory). Never applied when NODE_ENV=production. */
const DEV_DEFAULTS: Readonly<Record<string, string>> = {
  GCP_PROJECT: 'demo-certificate-manager',
  SERVICE_URL: 'http://localhost:8080',
  PUBLIC_BASE_URL: 'http://localhost:5173',
  PDF_PUBLIC_BASE_URL: 'http://localhost:8080',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  EMAIL_PROVIDER: 'gmail',
  EMAIL_FROM_ADDRESS: 'certificates@example.com',
  DB_ADAPTER: 'memory',
  STORAGE_ADAPTER: 'memory',
  QUEUE_ADAPTER: 'in-process',
  AUTH_PROVIDER: 'firebase',
};

const GENERAL_DEFAULTS: Readonly<Record<string, string>> = {
  NODE_ENV: 'development',
  PORT: '8080',
  LOG_LEVEL: 'info',
  EMAIL_FROM_NAME: 'Certificate Manager',
  EMAIL_DAILY_CAP: '300',
  RATE_LIMIT_PUBLIC_PER_MIN: '10',
  RATE_LIMIT_ADMIN_PER_MIN: '60',
};

const FLAG_DEFS = {
  FEATURE_OPENAPI_ENDPOINT: { key: 'openApiEndpoint', default: (prod: boolean) => !prod },
  FEATURE_BOUNCE_JOB: { key: 'bounceJob', default: () => false },
  FEATURE_EMAIL_FALLBACK: { key: 'emailFallback', default: () => true },
  FEATURE_BULK_ISSUANCE: { key: 'bulkIssuance', default: () => true },
  FEATURE_PUBLIC_PDF_GENERATION: { key: 'publicPdfGeneration', default: () => true },
} as const satisfies Record<string, { key: keyof Flags; default: (prod: boolean) => boolean }>;

const MAX_URL_LENGTH = 2048;

const text = (max = 200) => z.string().min(1).max(max);
const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().refine((v) => (values as readonly string[]).includes(v), {
    message: `must be one of: ${values.join(', ')}`,
  }) as unknown as z.ZodType<T[number]>;
const int = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform(Number)
    .refine((n) => n >= min && n <= max, { message: `must be between ${min} and ${max}` });
const email = z
  .string()
  .max(254)
  .pipe(z.email({ message: 'must be a valid email address' }));
const url = z
  .string()
  .max(MAX_URL_LENGTH)
  .pipe(z.url({ message: 'must be a valid URL' }));

const schema = z.object({
  NODE_ENV: oneOf(NODE_ENVS),
  PORT: int(1, 65535),
  LOG_LEVEL: oneOf(LOG_LEVELS),
  GCP_PROJECT: text(100),
  SERVICE_URL: url,
  PUBLIC_BASE_URL: url,
  PDF_PUBLIC_BASE_URL: url,
  TEMPLATES_BUCKET: text(222).optional(),
  PDF_BUCKET: text(222).optional(),
  TASKS_QUEUE: text(100).optional(),
  TASKS_LOCATION: text(100).optional(),
  TASKS_INVOKER_SA: email.optional(),
  BOOTSTRAP_ADMIN_EMAIL: email,
  EMAIL_PROVIDER: oneOf(EMAIL_PROVIDERS),
  EMAIL_FALLBACK_PROVIDER: oneOf(EMAIL_PROVIDERS).optional(),
  EMAIL_API_KEY: z.string().max(1024).optional(),
  EMAIL_FROM_ADDRESS: email,
  EMAIL_FROM_NAME: text(120),
  EMAIL_REPLY_TO: email.optional(),
  EMAIL_DAILY_CAP: int(1, 1_000_000),
  RATE_LIMIT_PUBLIC_PER_MIN: int(1, 10_000),
  RATE_LIMIT_ADMIN_PER_MIN: int(30, 100),
  DB_ADAPTER: oneOf(DB_ADAPTERS),
  STORAGE_ADAPTER: oneOf(STORAGE_ADAPTERS),
  QUEUE_ADAPTER: oneOf(QUEUE_ADAPTERS),
  AUTH_PROVIDER: oneOf(AUTH_PROVIDERS),
});

const BOOLEAN_TEXT = /^(true|false|1|0)$/;

/** Rules involving several variables, evaluated on the raw (normalised) strings. */
function crossFieldIssues(env: Env, isProd: boolean): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (variable: string, message: string) => issues.push({ variable, message });
  const missing = (name: string) => env[name] === undefined;

  for (const name of ['SERVICE_URL', 'PUBLIC_BASE_URL', 'PDF_PUBLIC_BASE_URL']) {
    const value = env[name];
    if (value === undefined) continue;
    if (value.endsWith('/')) add(name, 'must not end with "/"');
    if (isProd && !value.startsWith('https://'))
      add(name, 'must use https when NODE_ENV=production');
  }

  const provider = env['EMAIL_PROVIDER'];
  const fallback = env['EMAIL_FALLBACK_PROVIDER'];
  if (provider !== undefined && provider === fallback) {
    add('EMAIL_FALLBACK_PROVIDER', 'must differ from EMAIL_PROVIDER');
  }
  if ((provider === 'brevo' || fallback === 'brevo') && missing('EMAIL_API_KEY')) {
    add(
      'EMAIL_API_KEY',
      'is required when brevo is used as EMAIL_PROVIDER or EMAIL_FALLBACK_PROVIDER',
    );
  }

  if (env['STORAGE_ADAPTER'] === 'gcs') {
    for (const name of ['TEMPLATES_BUCKET', 'PDF_BUCKET']) {
      if (missing(name)) add(name, 'is required when STORAGE_ADAPTER=gcs');
    }
  }
  if (env['QUEUE_ADAPTER'] === 'cloud-tasks') {
    for (const name of ['TASKS_QUEUE', 'TASKS_LOCATION', 'TASKS_INVOKER_SA']) {
      if (missing(name)) add(name, 'is required when QUEUE_ADAPTER=cloud-tasks');
    }
  }
  if (isProd) {
    for (const [name, bad] of [
      ['DB_ADAPTER', 'memory'],
      ['STORAGE_ADAPTER', 'memory'],
      ['QUEUE_ADAPTER', 'in-process'],
    ] as const) {
      if (env[name] === bad) add(name, `"${bad}" is not allowed when NODE_ENV=production`);
    }
  }
  return issues;
}

function parseFlags(env: Env, isProd: boolean): { flags: Flags; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const known = Object.keys(FLAG_DEFS);
  for (const name of Object.keys(env)) {
    if (name.startsWith('FEATURE_') && !known.includes(name)) {
      issues.push({ variable: name, message: `unknown feature flag (known: ${known.join(', ')})` });
    }
  }
  const out: Record<string, boolean> = {};
  for (const [name, def] of Object.entries(FLAG_DEFS)) {
    const raw = env[name];
    if (raw === undefined) {
      out[def.key] = def.default(isProd);
    } else if (BOOLEAN_TEXT.test(raw)) {
      out[def.key] = raw === 'true' || raw === '1';
    } else {
      issues.push({ variable: name, message: 'must be one of: true, false, 1, 0' });
      out[def.key] = def.default(isProd);
    }
  }
  return { flags: out as unknown as Flags, issues };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalise(env: Env): Env {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    // Empty or whitespace-only values count as "not set" (docker/.env friendliness).
    if (v !== undefined && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

/** Validates `env` and returns an immutable, typed Config. Throws {@link ConfigError} listing every violation. */
export function loadConfig(env: Env): Config {
  const given = normalise(env);
  const isProd = given['NODE_ENV'] === 'production';
  const merged: Env = { ...GENERAL_DEFAULTS, ...(isProd ? {} : DEV_DEFAULTS), ...given };

  const issues: ConfigIssue[] = [];
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const variable = String(issue.path[0] ?? 'config');
      const message =
        issue.code === 'invalid_type' && merged[variable] === undefined
          ? 'is required'
          : issue.message;
      issues.push({ variable, message });
    }
  }
  issues.push(...crossFieldIssues(merged, isProd));
  const { flags, issues: flagIssues } = parseFlags(merged, isProd);
  issues.push(...flagIssues);

  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const key = `${i.variable}\u0000${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length > 0 || !parsed.success) throw new ConfigError(unique);

  const e = parsed.data;
  return deepFreeze<Config>({
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    gcpProject: e.GCP_PROJECT,
    serviceUrl: e.SERVICE_URL,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    pdfPublicBaseUrl: e.PDF_PUBLIC_BASE_URL,
    storage: { templatesBucket: e.TEMPLATES_BUCKET, pdfBucket: e.PDF_BUCKET },
    tasks: {
      queue: e.TASKS_QUEUE,
      location: e.TASKS_LOCATION,
      invokerServiceAccount: e.TASKS_INVOKER_SA,
    },
    bootstrapAdminEmail: e.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
    email: {
      provider: e.EMAIL_PROVIDER,
      fallbackProvider: e.EMAIL_FALLBACK_PROVIDER,
      apiKey: e.EMAIL_API_KEY,
      fromAddress: e.EMAIL_FROM_ADDRESS,
      fromName: e.EMAIL_FROM_NAME,
      replyTo: e.EMAIL_REPLY_TO,
      dailyCap: e.EMAIL_DAILY_CAP,
    },
    rateLimit: {
      publicPerMin: e.RATE_LIMIT_PUBLIC_PER_MIN,
      adminPerMin: e.RATE_LIMIT_ADMIN_PER_MIN,
    },
    adapters: {
      db: e.DB_ADAPTER,
      storage: e.STORAGE_ADAPTER,
      queue: e.QUEUE_ADAPTER,
      auth: e.AUTH_PROVIDER,
    },
    flags,
  });
}
