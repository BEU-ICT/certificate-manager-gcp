// Routes with a happy-path test in this file (checked by test/unit/authz-matrix.test.ts):
// happy-path: GET /api/v1/admin/stats
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { openApiDocument } from '../../src/http/openapi/plugin.js';
import { buildServices } from '../../src/services.js';
import { createFakes } from '../../src/testing/fakes/index.js';
import { describeStatsApi } from '../helpers/stats-api-suite.js';

describeStatsApi('in-memory fakes', () => createFakes());

describe('stats service', () => {
  it('does not cache failures and can disable the cache', async () => {
    const fakes = createFakes();
    let fail = true;
    const original = fakes.certificates.count.bind(fakes.certificates);
    fakes.certificates.count = (filter) =>
      fail ? Promise.reject(new Error('boom')) : original(filter);
    const { stats } = buildServices(fakes, undefined, { statsCacheSeconds: 0 });
    await expect(stats.get({ refresh: false, adminUid: 'a' })).rejects.toThrow('boom');
    fail = false;
    const first = await stats.get({ refresh: false, adminUid: 'a' });
    fakes.clock.advance(1);
    const second = await stats.get({ refresh: false, adminUid: 'a' });
    expect(second.generatedAt).not.toBe(first.generatedAt);
  });
});

describe('admin stats OpenAPI', () => {
  it('documents the endpoint', async () => {
    const fakes = createFakes();
    const app = buildApp({ ports: fakes, services: buildServices(fakes) });
    await app.ready();
    const doc = openApiDocument(app) as unknown as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    await app.close();
    expect(doc.paths['/api/v1/admin/stats']?.['get']?.operationId).toBe('getAdminStats');
  });
});
