import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const SECRET = 's3cr3t-key-VALUE-98765';

const prod = {
  NODE_ENV: 'production',
  GCP_PROJECT: 'my-project',
  SERVICE_URL: 'https://api.example.com',
  PUBLIC_BASE_URL: 'https://certs.example.com',
  PDF_PUBLIC_BASE_URL: 'https://pdf.example.com',
  TEMPLATES_BUCKET: 'tpl',
  PDF_BUCKET: 'pdf',
  TASKS_QUEUE: 'q',
  TASKS_LOCATION: 'us-east1',
  TASKS_INVOKER_SA: 'invoker@my-project.iam.gserviceaccount.com',
  BOOTSTRAP_ADMIN_EMAIL: 'Admin@Example.com',
  EMAIL_PROVIDER: 'gmail',
  EMAIL_FROM_ADDRESS: 'certs@example.com',
  DB_ADAPTER: 'firestore',
  STORAGE_ADAPTER: 'gcs',
  QUEUE_ADAPTER: 'cloud-tasks',
  AUTH_PROVIDER: 'firebase',
};

function issuesOf(env: Record<string, string | undefined>) {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).issues;
  }
  throw new Error('expected loadConfig to throw');
}
const vars = (env: Record<string, string | undefined>) => issuesOf(env).map((i) => i.variable);

describe('loadConfig', () => {
  it('loads a valid production config with typed values and defaults', () => {
    const c = loadConfig(prod);
    expect(c.env).toBe('production');
    expect(c.port).toBe(8080);
    expect(c.rateLimit).toEqual({ publicPerMin: 10, adminPerMin: 60 });
    expect(c.bootstrapAdminEmail).toBe('admin@example.com');
    expect(c.adapters.db).toBe('firestore');
    expect(c.flags).toEqual({
      openApiEndpoint: false,
      bounceJob: false,
      emailFallback: true,
      bulkIssuance: true,
      publicPdfGeneration: true,
    });
  });

  it('works with an empty environment outside production (local defaults)', () => {
    const c = loadConfig({});
    expect(c.env).toBe('development');
    expect(c.adapters).toEqual({
      db: 'memory',
      storage: 'memory',
      queue: 'in-process',
      auth: 'firebase',
    });
    expect(c.flags.openApiEndpoint).toBe(true);
  });

  it('is pure: does not read process.env or mutate its input', () => {
    const input = Object.freeze({ ...prod });
    process.env['PORT'] = '9999';
    try {
      expect(loadConfig(input).port).toBe(8080);
    } finally {
      delete process.env['PORT'];
    }
  });

  it('returns a deeply frozen object', () => {
    const c = loadConfig(prod);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.email)).toBe(true);
    expect(Object.isFrozen(c.flags)).toBe(true);
    expect(() => {
      (c.flags as { bounceJob: boolean }).bounceJob = true;
    }).toThrow(TypeError);
  });

  it('treats empty strings as unset', () => {
    expect(loadConfig({ ...prod, EMAIL_REPLY_TO: '', PORT: '' }).port).toBe(8080);
  });

  it('reports every missing variable in production with an empty env', () => {
    const issues = issuesOf({ NODE_ENV: 'production' });
    const names = issues.map((i) => i.variable);
    expect(names).toEqual(
      expect.arrayContaining([
        'GCP_PROJECT',
        'SERVICE_URL',
        'PUBLIC_BASE_URL',
        'PDF_PUBLIC_BASE_URL',
        'BOOTSTRAP_ADMIN_EMAIL',
        'EMAIL_PROVIDER',
        'EMAIL_FROM_ADDRESS',
        'DB_ADAPTER',
        'STORAGE_ADAPTER',
        'QUEUE_ADAPTER',
        'AUTH_PROVIDER',
      ]),
    );
    expect(issues.every((i) => i.message.length > 0)).toBe(true);
  });

  it('collects all violations at once', () => {
    const names = vars({ ...prod, PORT: 'abc', LOG_LEVEL: 'loud', RATE_LIMIT_ADMIN_PER_MIN: '5' });
    expect(names).toEqual(['PORT', 'LOG_LEVEL', 'RATE_LIMIT_ADMIN_PER_MIN']);
  });

  describe('cross-field rules', () => {
    it.each(['29', '101'])('rejects RATE_LIMIT_ADMIN_PER_MIN=%s', (v) => {
      expect(vars({ ...prod, RATE_LIMIT_ADMIN_PER_MIN: v })).toEqual(['RATE_LIMIT_ADMIN_PER_MIN']);
    });
    it.each(['30', '100'])('accepts RATE_LIMIT_ADMIN_PER_MIN=%s', (v) => {
      expect(loadConfig({ ...prod, RATE_LIMIT_ADMIN_PER_MIN: v }).rateLimit.adminPerMin).toBe(
        Number(v),
      );
    });

    it('requires EMAIL_API_KEY for brevo (primary or fallback)', () => {
      expect(vars({ ...prod, EMAIL_PROVIDER: 'brevo' })).toEqual(['EMAIL_API_KEY']);
      expect(vars({ ...prod, EMAIL_FALLBACK_PROVIDER: 'brevo' })).toEqual(['EMAIL_API_KEY']);
      const c = loadConfig({ ...prod, EMAIL_PROVIDER: 'brevo', EMAIL_API_KEY: SECRET });
      expect(c.email.apiKey).toBe(SECRET);
    });

    it('rejects a fallback equal to the provider', () => {
      expect(vars({ ...prod, EMAIL_FALLBACK_PROVIDER: 'gmail' })).toEqual([
        'EMAIL_FALLBACK_PROVIDER',
      ]);
    });

    it('requires https URLs in production only', () => {
      expect(vars({ ...prod, SERVICE_URL: 'http://api.example.com' })).toEqual(['SERVICE_URL']);
      expect(loadConfig({ NODE_ENV: 'development', SERVICE_URL: 'http://x.test' }).serviceUrl).toBe(
        'http://x.test',
      );
    });

    it.each(['SERVICE_URL', 'PUBLIC_BASE_URL', 'PDF_PUBLIC_BASE_URL'])(
      'rejects a trailing slash in %s (any environment)',
      (name) => {
        expect(vars({ ...prod, [name]: 'https://x.example.com/' })).toEqual([name]);
        expect(vars({ [name]: 'http://localhost:1/' })).toEqual([name]);
      },
    );

    it.each([
      ['DB_ADAPTER', 'postgres'],
      ['STORAGE_ADAPTER', 's3'],
      ['QUEUE_ADAPTER', 'pubsub'],
      ['AUTH_PROVIDER', 'auth0'],
      ['EMAIL_PROVIDER', 'sendgrid'],
    ])('restricts %s to the implemented set', (name, value) => {
      expect(vars({ ...prod, [name]: value })).toEqual([name]);
    });

    it('requires buckets for gcs and queue settings for cloud-tasks', () => {
      expect(vars({ ...prod, TEMPLATES_BUCKET: undefined, PDF_BUCKET: undefined })).toEqual([
        'TEMPLATES_BUCKET',
        'PDF_BUCKET',
      ]);
      expect(vars({ ...prod, TASKS_QUEUE: undefined, TASKS_INVOKER_SA: undefined })).toEqual([
        'TASKS_QUEUE',
        'TASKS_INVOKER_SA',
      ]);
    });

    it('forbids in-memory adapters in production', () => {
      expect(vars({ ...prod, DB_ADAPTER: 'memory' })).toEqual(['DB_ADAPTER']);
    });
  });

  describe('feature flags', () => {
    it('parses true/false/1/0', () => {
      const c = loadConfig({
        ...prod,
        FEATURE_BOUNCE_JOB: '1',
        FEATURE_EMAIL_FALLBACK: '0',
        FEATURE_BULK_ISSUANCE: 'false',
        FEATURE_OPENAPI_ENDPOINT: 'true',
      });
      expect(c.flags).toMatchObject({
        bounceJob: true,
        emailFallback: false,
        bulkIssuance: false,
        openApiEndpoint: true,
      });
    });
    it('rejects invalid values and unknown FEATURE_* variables', () => {
      expect(vars({ ...prod, FEATURE_BOUNCE_JOB: 'yes', FEATURE_TYPO: 'true' })).toEqual([
        'FEATURE_TYPO',
        'FEATURE_BOUNCE_JOB',
      ]);
    });
  });

  describe('secrets', () => {
    it('never appear in error output', () => {
      let message = '';
      try {
        loadConfig({
          ...prod,
          EMAIL_API_KEY: SECRET,
          EMAIL_PROVIDER: 'gmail',
          EMAIL_FALLBACK_PROVIDER: 'gmail',
          PORT: 'x',
          FEATURE_BOUNCE_JOB: SECRET,
          LOG_LEVEL: SECRET,
          SERVICE_URL: SECRET,
        });
      } catch (err) {
        message = JSON.stringify((err as ConfigError).issues) + (err as ConfigError).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(SECRET);
    });
  });

  it('parses .env.example', () => {
    const env: Record<string, string> = {};
    const file = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    for (const line of file.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m?.[1] !== undefined && m[2] !== undefined) env[m[1]] = m[2];
    }
    expect(Object.keys(env).length).toBeGreaterThan(20);
    expect(() => loadConfig(env)).not.toThrow();
  });
});
