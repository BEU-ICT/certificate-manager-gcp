import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { fakeToken } from '../../src/testing/fakes/index.js';
import { describeOrganizationsApi } from '../helpers/organizations-api-suite.js';
import { createFakes } from '../../src/testing/fakes/index.js';

describeOrganizationsApi('in-memory fakes', () => createFakes());

describe('audit log', () => {
  it('records create, rename and delete with action, entityId and adminUid', async () => {
    const lines: string[] = [];
    const destination = { write: (line: string) => void lines.push(line) };
    const ports = createFakes();
    const app = buildApp({
      ports,
      adminRateLimitPerMin: 1000,
      log: { level: 'info', destination },
    });
    const headers = { authorization: `Bearer ${fakeToken('admin-7', 'admin')}` };
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/organizations',
        headers,
        payload: { name: 'Audited' },
      })
    ).json<{ id: string }>();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${created.id}`,
      headers,
      payload: { name: 'Audited 2' },
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${created.id}`,
      headers,
    });
    await app.close();
    const audits = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l['audit'] === true);
    expect(audits.map((a) => a['action'])).toEqual([
      'organization.create',
      'organization.rename',
      'organization.delete',
    ]);
    for (const a of audits) {
      expect(a).toMatchObject({ entityId: created.id, adminUid: 'admin-7' });
    }
  });
});
