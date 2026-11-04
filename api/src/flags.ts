/**
 * Feature-flag registry: the single source of truth for every `FEATURE_*` variable.
 * Removing a flag is a change to this file plus its usages (BEU-ICT/certificate-manager#23 rule 7).
 *
 * Pure module: reads no environment itself. `config.ts` passes the environment in and exposes the
 * result as `config.flags`; consumers receive a {@link FeatureFlags} (`isEnabled`) as a dependency.
 */

export interface FlagDefinition {
  /** Environment variable, always `FEATURE_*`. */
  readonly env: string;
  readonly description: string;
  /** Default when the variable is unset. */
  readonly default: (isProduction: boolean) => boolean;
  /** Kill switch: a guarded route answers 503 UNAVAILABLE (not 404) while the flag is off. */
  readonly killSwitch?: boolean;
}

export const FLAG_REGISTRY = {
  openApiEndpoint: {
    env: 'FEATURE_OPENAPI_ENDPOINT',
    description: 'Serve the OpenAPI document. Off in production, on elsewhere.',
    default: (prod) => !prod,
  },
  bounceJob: {
    env: 'FEATURE_BOUNCE_JOB',
    description: 'Run the bounce-processing job. Off until verified (#161).',
    default: () => false,
  },
  emailFallback: {
    env: 'FEATURE_EMAIL_FALLBACK',
    description: 'Fall back to EMAIL_FALLBACK_PROVIDER when the primary e-mail provider fails.',
    default: () => true,
  },
  bulkIssuance: {
    env: 'FEATURE_BULK_ISSUANCE',
    description: 'Allow bulk certificate issuance.',
    default: () => true,
  },
  publicPdfGeneration: {
    env: 'FEATURE_PUBLIC_PDF_GENERATION',
    description: 'On-demand public PDF generation. Kill switch: the endpoint returns 503 when off.',
    default: () => true,
    killSwitch: true,
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagName = keyof typeof FLAG_REGISTRY;
/** Resolved flag values keyed by {@link FlagName}. */
export type Flags = { readonly [K in FlagName]: boolean };

export const FLAG_NAMES = Object.keys(FLAG_REGISTRY) as FlagName[];

export interface FlagIssue {
  readonly variable: string;
  readonly message: string;
}

const BOOLEAN_TEXT = /^(true|false|1|0)$/;

/**
 * Resolves all flags from a (normalised) environment. Unknown `FEATURE_*` variables and invalid
 * values are reported as issues; values are never echoed.
 */
export function parseFlags(
  env: Readonly<Record<string, string | undefined>>,
  isProduction: boolean,
): { flags: Flags; issues: FlagIssue[] } {
  const issues: FlagIssue[] = [];
  const known = FLAG_NAMES.map((n) => FLAG_REGISTRY[n].env as string);
  for (const name of Object.keys(env)) {
    if (name.startsWith('FEATURE_') && !known.includes(name)) {
      issues.push({ variable: name, message: `unknown feature flag (known: ${known.join(', ')})` });
    }
  }
  const out: Record<string, boolean> = {};
  for (const key of FLAG_NAMES) {
    const def: FlagDefinition = FLAG_REGISTRY[key];
    const raw = env[def.env];
    if (raw !== undefined && BOOLEAN_TEXT.test(raw)) {
      out[key] = raw === 'true' || raw === '1';
    } else {
      if (raw !== undefined) {
        issues.push({ variable: def.env, message: 'must be one of: true, false, 1, 0' });
      }
      out[key] = def.default(isProduction);
    }
  }
  return { flags: Object.freeze(out) as Flags, issues };
}

/** Dependency handed to modules and routes; wraps the immutable resolved values. */
export interface FeatureFlags {
  isEnabled(name: FlagName): boolean;
  /** True when the flag is a kill switch (guarded routes answer 503 instead of 404). */
  isKillSwitch(name: FlagName): boolean;
}

export function createFeatureFlags(flags: Flags): FeatureFlags {
  return {
    isEnabled: (name) => flags[name],
    isKillSwitch: (name) => 'killSwitch' in FLAG_REGISTRY[name],
  };
}

/**
 * Flags exposed to the admin UI as `features` in `GET /api/v1/admin/me`, so it can hide disabled
 * actions. Server-internal switches (OpenAPI endpoint, bounce job, e-mail fallback) stay private.
 */
export const ADMIN_VISIBLE_FLAGS = [
  'bulkIssuance',
  'publicPdfGeneration',
] as const satisfies readonly FlagName[];

export type AdminFeatures = { readonly [K in (typeof ADMIN_VISIBLE_FLAGS)[number]]: boolean };

export function buildAdminFeatures(flags: FeatureFlags): AdminFeatures {
  return Object.fromEntries(
    ADMIN_VISIBLE_FLAGS.map((name) => [name, flags.isEnabled(name)]),
  ) as AdminFeatures;
}
