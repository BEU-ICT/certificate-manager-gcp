import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { installErrorHandling } from '../../src/http/error-handler.js';
import { requireFlag } from '../../src/http/flag-guard.js';
import {
  ADMIN_VISIBLE_FLAGS,
  FLAG_NAMES,
  FLAG_REGISTRY,
  buildAdminFeatures,
  createFeatureFlags,
  parseFlags,
  type Flags,
} from '../../src/flags.js';

const allOn = Object.fromEntries(FLAG_NAMES.map((n) => [n, true])) as unknown as Flags;
const withFlag = (name: keyof Flags, value: boolean): Flags => ({ ...allOn, [name]: value });

describe('parseFlags', () => {
  it('applies registry defaults (OpenAPI differs by environment)', () => {
    expect(parseFlags({}, true).flags).toEqual({
      openApiEndpoint: false,
      bounceJob: false,
      emailFallback: true,
      bulkIssuance: true,
      publicPdfGeneration: true,
    });
    expect(parseFlags({}, false).flags.openApiEndpoint).toBe(true);
  });

  it('parses true/false/1/0', () => {
    const { flags, issues } = parseFlags(
      {
        FEATURE_BOUNCE_JOB: '1',
        FEATURE_EMAIL_FALLBACK: '0',
        FEATURE_BULK_ISSUANCE: 'false',
        FEATURE_OPENAPI_ENDPOINT: 'true',
      },
      true,
    );
    expect(issues).toEqual([]);
    expect(flags).toMatchObject({
      bounceJob: true,
      emailFallback: false,
      bulkIssuance: false,
      openApiEndpoint: true,
    });
  });

  it('rejects unknown FEATURE_* variables without echoing values', () => {
    const { issues } = parseFlags({ FEATURE_TYPO: 'secret-value' }, true);
    expect(issues.map((i) => i.variable)).toEqual(['FEATURE_TYPO']);
    expect(JSON.stringify(issues)).not.toContain('secret-value');
  });

  it('rejects invalid values and falls back to the default', () => {
    const { flags, issues } = parseFlags({ FEATURE_BULK_ISSUANCE: 'yes' }, true);
    expect(issues.map((i) => i.variable)).toEqual(['FEATURE_BULK_ISSUANCE']);
    expect(flags.bulkIssuance).toBe(true);
  });

  it('ignores non-FEATURE variables and returns a frozen object', () => {
    const { flags, issues } = parseFlags({ PORT: '1', FEATURES_X: 'y' }, true);
    expect(issues).toEqual([]);
    expect(Object.isFrozen(flags)).toBe(true);
  });

  it('keeps every registry env name prefixed FEATURE_ and unique', () => {
    const names = FLAG_NAMES.map((n) => FLAG_REGISTRY[n].env as string);
    expect(names.every((n) => n.startsWith('FEATURE_'))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('createFeatureFlags', () => {
  it('answers isEnabled from the resolved values', () => {
    const flags = createFeatureFlags(withFlag('bounceJob', false));
    expect(flags.isEnabled('bounceJob')).toBe(false);
    expect(flags.isEnabled('bulkIssuance')).toBe(true);
  });

  it('marks only publicPdfGeneration as kill switch', () => {
    const flags = createFeatureFlags(allOn);
    expect(FLAG_NAMES.filter((n) => flags.isKillSwitch(n))).toEqual(['publicPdfGeneration']);
  });
});

describe('requireFlag route guard', () => {
  async function call(values: Flags, name: 'bulkIssuance' | 'publicPdfGeneration') {
    const app = Fastify();
    installErrorHandling(app);
    app.get('/guarded', { onRequest: requireFlag(createFeatureFlags(values), name) }, () => ({
      ok: true,
    }));
    const res = await app.inject({ method: 'GET', url: '/guarded' });
    await app.close();
    return res;
  }

  it('lets requests through when the flag is on', async () => {
    const res = await call(allOn, 'bulkIssuance');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('hides the route with 404 NOT_FOUND when a regular flag is off', async () => {
    const res = await call(withFlag('bulkIssuance', false), 'bulkIssuance');
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('answers 503 UNAVAILABLE with Retry-After when a kill-switch flag is off', async () => {
    const res = await call(withFlag('publicPdfGeneration', false), 'publicPdfGeneration');
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNAVAILABLE');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('buildAdminFeatures', () => {
  it('exposes only the admin-visible flags with their current state', () => {
    const features = buildAdminFeatures(
      createFeatureFlags({ ...withFlag('bulkIssuance', false), bounceJob: true }),
    );
    expect(features).toEqual({ bulkIssuance: false, publicPdfGeneration: true });
    expect(Object.keys(features)).toEqual([...ADMIN_VISIBLE_FLAGS]);
  });
});
