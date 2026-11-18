import { z } from 'zod';
import { parseFlags, type Flags } from './flags.js';

export type { Flags } from './flags.js';

/**
 * Typed, fail-fast configuration (twelve-factor). `loadConfig` is a pure function of its input:
 * it never reads `process.env` itself; the composition root (server.ts) passes the environment in.
 *
 * Error messages are built from variable names and fixed texts only. Values are never echoed, so
 * secrets (EMAIL_API_KEY, ...) cannot leak through validation errors.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const DB_ADAPTERS = ['firestore', 'postgres', 'memory'] as const;
export const DATABASE_SSL_MODES = ['disable', 'require', 'verify-full'] as const;
export const STORAGE_ADAPTERS = ['gcs', 's3', 'fs', 'memory'] as const;
export const QUEUE_ADAPTERS = ['cloud-tasks', 'in-process', 'bullmq'] as const;
export const RATE_LIMITERS = ['in-process', 'redis'] as const;
export const AUTH_PROVIDERS = ['firebase', 'oidc'] as const;
export const EMAIL_PROVIDERS = ['gmail', 'brevo', 'smtp', 'file'] as const;

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
    /** `STORAGE_ADAPTER=s3` (AWS S3, MinIO, ...). Credentials fall back to the SDK default chain. */
    readonly s3: {
      readonly endpoint: string | undefined;
      readonly region: string;
      readonly forcePathStyle: boolean;
      readonly accessKeyId: string | undefined;
      readonly secretAccessKey: string | undefined;
    };
  };
  readonly tasks: {
    readonly queue: string | undefined;
    readonly location: string | undefined;
    readonly invokerServiceAccount: string | undefined;
  };
  /** Redis for `QUEUE_ADAPTER=bullmq` and `RATE_LIMITER=redis`; auth and TLS come with the URL. Secret. */
  readonly redis: { readonly url: string | undefined };
  /** Run the queue worker in this process (`QUEUE_ADAPTER=bullmq`). */
  readonly workerEnabled: boolean;
  readonly bootstrapAdminEmail: string;
  /** Reject ID tokens of disabled or revoked users (one Auth API call per admin request). */
  readonly authCheckRevoked: boolean;
  /** Present when AUTH_PROVIDER=oidc. */
  readonly oidc:
    | {
        readonly issuer: string;
        readonly audience: string;
        readonly roleClaim: string;
        readonly adminRole: string;
        readonly jwksUri: string | undefined;
      }
    | undefined;
  readonly email: {
    readonly provider: (typeof EMAIL_PROVIDERS)[number];
    readonly fallbackProvider: (typeof EMAIL_PROVIDERS)[number] | undefined;
    /** Secret. Never log. */
    readonly apiKey: string | undefined;
    readonly fromAddress: string;
    readonly fromName: string;
    readonly replyTo: string | undefined;
    /** Output directory of the local-only `file` provider (`EMAIL_FILE_DIR`). */
    readonly fileDir: string;
    /** `smtp` provider (`SMTP_*`). `tls`: starttls (default, enforced), tls (implicit) or none (dev only). */
    readonly smtp: {
      readonly host: string | undefined;
      readonly port: number;
      readonly tls: 'starttls' | 'tls' | 'none';
      readonly user: string | undefined;
      /** Secret. Never log. */
      readonly password: string | undefined;
    };
    readonly dailyCap: number;
    /** Daily cap of the fallback provider (`EMAIL_FALLBACK_DAILY_CAP`). */
    readonly fallbackDailyCap: number;
  };
  readonly rateLimit: {
    readonly publicPerMin: number;
    readonly adminPerMin: number;
  };
  /** Byte budget (MB) of the in-process template asset cache. */
  readonly templateCacheMb: number;
  /** Per-instance cache lifetime (seconds) of `GET /api/v1/admin/stats`; 0 disables it. */
  readonly statsCacheSeconds: number;
  /** PDF render guard (BEU-ICT/certificate-manager#328). */
  readonly pdf: {
    readonly maxConcurrentRenders: number;
    readonly renderTimeoutMs: number;
  };
  /** PostgreSQL connection (DB_ADAPTER=postgres, BEU-ICT/certificate-manager#429). */
  readonly database: {
    readonly url: string | undefined;
    readonly poolMax: number;
    readonly ssl: (typeof DATABASE_SSL_MODES)[number];
    /** PEM of the CA that signed the server certificate (used with `verify-full`). */
    readonly sslCa: string | undefined;
    readonly statementTimeoutMs: number;
    readonly connectionTimeoutMs: number;
  };
  readonly adapters: {
    readonly db: (typeof DB_ADAPTERS)[number];
    readonly storage: (typeof STORAGE_ADAPTERS)[number];
    readonly queue: (typeof QUEUE_ADAPTERS)[number];
    readonly auth: (typeof AUTH_PROVIDERS)[number];
    readonly rateLimiter: (typeof RATE_LIMITERS)[number];
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
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'false',
  NODE_ENV: 'development',
  PORT: '8080',
  LOG_LEVEL: 'info',
  AUTH_CHECK_REVOKED: 'false',
  OIDC_ROLE_CLAIM: 'realm_access.roles',
  OIDC_ADMIN_ROLE: 'admin',
  EMAIL_FROM_NAME: 'Certificate Manager',
  EMAIL_FILE_DIR: '.local-data/mail',
  EMAIL_DAILY_CAP: '300',
  SMTP_PORT: '587',
  SMTP_TLS: 'starttls',
  EMAIL_FALLBACK_DAILY_CAP: '300',
  RATE_LIMITER: 'in-process',
  WORKER_ENABLED: 'true',
  RATE_LIMIT_PUBLIC_PER_MIN: '10',
  RATE_LIMIT_ADMIN_PER_MIN: '60',
  TEMPLATE_CACHE_MB: '40',
  STATS_CACHE_SECONDS: '60',
  PDF_MAX_CONCURRENT_RENDERS: '3',
  PDF_RENDER_TIMEOUT_MS: '30000',
  DATABASE_SSL: 'disable',
  DATABASE_POOL_MAX: '10',
  DATABASE_STATEMENT_TIMEOUT_MS: '15000',
  DATABASE_CONNECTION_TIMEOUT_MS: '5000',
};

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
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\/\S+$/, 'must be a redis:// or rediss:// URL')
    .max(2048)
    .optional(),
  WORKER_ENABLED: oneOf(['true', 'false'] as const),
  RATE_LIMITER: oneOf(RATE_LIMITERS),
  S3_ENDPOINT: url.optional(),
  S3_REGION: text(50),
  S3_FORCE_PATH_STYLE: oneOf(['true', 'false'] as const),
  S3_ACCESS_KEY_ID: text(256).optional(),
  S3_SECRET_ACCESS_KEY: z.string().max(1024).optional(),
  TASKS_QUEUE: text(100).optional(),
  TASKS_LOCATION: text(100).optional(),
  TASKS_INVOKER_SA: email.optional(),
  BOOTSTRAP_ADMIN_EMAIL: email,
  AUTH_CHECK_REVOKED: oneOf(['true', 'false'] as const),
  OIDC_ISSUER: url.optional(),
  OIDC_AUDIENCE: text(200).optional(),
  OIDC_JWKS_URI: url.optional(),
  OIDC_ROLE_CLAIM: text(200),
  OIDC_ADMIN_ROLE: text(200),
  EMAIL_PROVIDER: oneOf(EMAIL_PROVIDERS),
  EMAIL_FALLBACK_PROVIDER: oneOf(EMAIL_PROVIDERS).optional(),
  EMAIL_API_KEY: z.string().max(1024).optional(),
  EMAIL_FROM_ADDRESS: email,
  EMAIL_FROM_NAME: text(120),
  EMAIL_REPLY_TO: email.optional(),
  EMAIL_FILE_DIR: text(500),
  SMTP_HOST: text(255).optional(),
  SMTP_PORT: int(1, 65535),
  SMTP_TLS: oneOf(['starttls', 'tls', 'none'] as const),
  SMTP_USER: z.string().max(254).optional(),
  SMTP_PASSWORD: z.string().max(1024).optional(),
  EMAIL_DAILY_CAP: int(1, 1_000_000),
  EMAIL_FALLBACK_DAILY_CAP: int(1, 1_000_000),
  RATE_LIMIT_PUBLIC_PER_MIN: int(1, 10_000),
  RATE_LIMIT_ADMIN_PER_MIN: int(30, 100),
  TEMPLATE_CACHE_MB: int(1, 256),
  STATS_CACHE_SECONDS: int(0, 3600),
  PDF_MAX_CONCURRENT_RENDERS: int(1, 16),
  PDF_RENDER_TIMEOUT_MS: int(1000, 120_000),
  DATABASE_URL: z
    .string()
    .max(MAX_URL_LENGTH)
    .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'must be a postgres:// URL' })
    .optional(),
  DATABASE_SSL: oneOf(DATABASE_SSL_MODES),
  DATABASE_SSL_CA: z.string().max(20_000).optional(),
  DATABASE_POOL_MAX: int(1, 200),
  DATABASE_STATEMENT_TIMEOUT_MS: int(100, 600_000),
  DATABASE_CONNECTION_TIMEOUT_MS: int(100, 120_000),
  DB_ADAPTER: oneOf(DB_ADAPTERS),
  STORAGE_ADAPTER: oneOf(STORAGE_ADAPTERS),
  QUEUE_ADAPTER: oneOf(QUEUE_ADAPTERS),
  AUTH_PROVIDER: oneOf(AUTH_PROVIDERS),
});

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

  if ((provider === 'smtp' || fallback === 'smtp') && missing('SMTP_HOST')) {
    add('SMTP_HOST', 'is required when smtp is used as EMAIL_PROVIDER or EMAIL_FALLBACK_PROVIDER');
  }
  if (!missing('SMTP_PASSWORD') && missing('SMTP_USER'))
    add('SMTP_USER', 'is required with SMTP_PASSWORD');
  if (isProd && env['SMTP_TLS'] === 'none')
    add('SMTP_TLS', '"none" is for development, not allowed when NODE_ENV=production');

  if (isProd) {
    for (const name of ['EMAIL_PROVIDER', 'EMAIL_FALLBACK_PROVIDER']) {
      if (env[name] === 'file')
        add(name, '"file" is a local-only provider, not allowed when NODE_ENV=production');
    }
  }

  if (env['AUTH_PROVIDER'] === 'oidc') {
    for (const name of ['OIDC_ISSUER', 'OIDC_AUDIENCE']) {
      if (missing(name)) add(name, 'is required when AUTH_PROVIDER=oidc');
    }
  }

  if (env['STORAGE_ADAPTER'] === 'gcs' || env['STORAGE_ADAPTER'] === 's3') {
    for (const name of ['TEMPLATES_BUCKET', 'PDF_BUCKET']) {
      if (missing(name)) add(name, `is required when STORAGE_ADAPTER=${env['STORAGE_ADAPTER']}`);
    }
  }
  if (env['DB_ADAPTER'] === 'postgres' && missing('DATABASE_URL')) {
    add('DATABASE_URL', 'is required when DB_ADAPTER=postgres');
  }
  if (missing('S3_ACCESS_KEY_ID') !== missing('S3_SECRET_ACCESS_KEY')) {
    add('S3_SECRET_ACCESS_KEY', 'must be set together with S3_ACCESS_KEY_ID');
  }
  if (env['QUEUE_ADAPTER'] === 'cloud-tasks') {
    for (const name of ['TASKS_QUEUE', 'TASKS_LOCATION', 'TASKS_INVOKER_SA']) {
      if (missing(name)) add(name, 'is required when QUEUE_ADAPTER=cloud-tasks');
    }
  }
  if (env['QUEUE_ADAPTER'] === 'bullmq' && missing('REDIS_URL'))
    add('REDIS_URL', 'is required when QUEUE_ADAPTER=bullmq');
  if (env['RATE_LIMITER'] === 'redis' && missing('REDIS_URL'))
    add('REDIS_URL', 'is required when RATE_LIMITER=redis');
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
    storage: {
      templatesBucket: e.TEMPLATES_BUCKET,
      pdfBucket: e.PDF_BUCKET,
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      },
    },
    tasks: {
      queue: e.TASKS_QUEUE,
      location: e.TASKS_LOCATION,
      invokerServiceAccount: e.TASKS_INVOKER_SA,
    },
    redis: { url: e.REDIS_URL },
    workerEnabled: e.WORKER_ENABLED === 'true',
    bootstrapAdminEmail: e.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
    authCheckRevoked: e.AUTH_CHECK_REVOKED === 'true',
    oidc:
      e.AUTH_PROVIDER === 'oidc' && e.OIDC_ISSUER !== undefined && e.OIDC_AUDIENCE !== undefined
        ? {
            issuer: e.OIDC_ISSUER,
            audience: e.OIDC_AUDIENCE,
            roleClaim: e.OIDC_ROLE_CLAIM,
            adminRole: e.OIDC_ADMIN_ROLE,
            jwksUri: e.OIDC_JWKS_URI,
          }
        : undefined,
    email: {
      provider: e.EMAIL_PROVIDER,
      fallbackProvider: e.EMAIL_FALLBACK_PROVIDER,
      apiKey: e.EMAIL_API_KEY,
      fromAddress: e.EMAIL_FROM_ADDRESS,
      fromName: e.EMAIL_FROM_NAME,
      replyTo: e.EMAIL_REPLY_TO,
      fileDir: e.EMAIL_FILE_DIR,
      smtp: {
        host: e.SMTP_HOST,
        port: e.SMTP_PORT,
        tls: e.SMTP_TLS,
        user: e.SMTP_USER,
        password: e.SMTP_PASSWORD,
      },
      dailyCap: e.EMAIL_DAILY_CAP,
      fallbackDailyCap: e.EMAIL_FALLBACK_DAILY_CAP,
    },
    rateLimit: {
      publicPerMin: e.RATE_LIMIT_PUBLIC_PER_MIN,
      adminPerMin: e.RATE_LIMIT_ADMIN_PER_MIN,
    },
    templateCacheMb: e.TEMPLATE_CACHE_MB,
    statsCacheSeconds: e.STATS_CACHE_SECONDS,
    pdf: {
      maxConcurrentRenders: e.PDF_MAX_CONCURRENT_RENDERS,
      renderTimeoutMs: e.PDF_RENDER_TIMEOUT_MS,
    },
    database: {
      url: e.DATABASE_URL,
      poolMax: e.DATABASE_POOL_MAX,
      ssl: e.DATABASE_SSL,
      sslCa: e.DATABASE_SSL_CA,
      statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
      connectionTimeoutMs: e.DATABASE_CONNECTION_TIMEOUT_MS,
    },
    adapters: {
      db: e.DB_ADAPTER,
      storage: e.STORAGE_ADAPTER,
      queue: e.QUEUE_ADAPTER,
      auth: e.AUTH_PROVIDER,
      rateLimiter: e.RATE_LIMITER,
    },
    flags,
  });
}
