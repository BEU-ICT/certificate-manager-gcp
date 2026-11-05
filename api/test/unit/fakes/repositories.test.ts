import { describe, expect, it } from 'vitest';
import type { Certificate, Organization } from '../../../src/shared/domain.js';
import { ConflictError, ValidationError } from '../../../src/shared/errors.js';
import {
  asCertificateId,
  asEventId,
  asOrganizationId,
  asTemplateRef,
} from '../../../src/shared/ids.js';
import {
  FakeCertificateRepository,
  FakeOrganizationRepository,
} from '../../../src/testing/fakes/index.js';

const orgId = asOrganizationId('org1');
const evId = asEventId('ev1');
const day = (n: number) => new Date(Date.UTC(2026, 0, n));

const org = (n: number, slug = `org-${n}`): Organization => ({
  id: asOrganizationId(`org${n}`),
  slug,
  name: `Org ${n}`,
  createdAt: day(n),
  updatedAt: day(n),
  schemaVersion: 1,
});
const cert = (n: number, over: Partial<Certificate> = {}): Certificate => ({
  id: asCertificateId(String(n).padStart(22, 'a')),
  organizationId: orgId,
  eventId: evId,
  organizationName: 'Org',
  eventName: 'Event',
  templateId: asTemplateRef('t-v1'),
  type: 'attendance',
  status: 'active',
  ownerName: `Owner ${n}`,
  subject: 'Subject',
  skills: [],
  issuedAt: day(n),
  emailStatus: 'skipped',
  emailAttempts: 0,
  createdBy: 'admin-1',
  createdAt: day(n),
  updatedAt: day(n),
  schemaVersion: 1,
  ...over,
});

describe('FakeOrganizationRepository', () => {
  it('creates, reads, counts and rejects duplicate slug or id', async () => {
    const r = new FakeOrganizationRepository();
    await r.create(org(1, 'acme'));
    await expect(r.create(org(2, 'acme'))).rejects.toBeInstanceOf(ConflictError);
    await expect(r.create({ ...org(3), id: org(1).id })).rejects.toBeInstanceOf(ConflictError);
    expect(await r.count()).toBe(1);
    expect((await r.getBySlug('acme'))?.id).toBe(org(1).id);
    expect(await r.getById(asOrganizationId('nope'))).toBeNull();
    expect(await r.getBySlug('nope')).toBeNull();
  });

  it('returns copies, not stored references', async () => {
    const r = new FakeOrganizationRepository();
    await r.create(org(1));
    const got = await r.getById(org(1).id);
    got!.name = 'changed';
    expect((await r.getById(org(1).id))?.name).toBe('Org 1');
  });

  it('paginates by name with opaque cursors, default 25 and max 50', async () => {
    const r = new FakeOrganizationRepository();
    for (let i = 1; i <= 60; i++) await r.create(org(i));
    const first = await r.list();
    expect(first.items).toHaveLength(25);
    expect(first.items[0]?.slug).toBe('org-1');
    const seen = [...first.items];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await r.list({ limit: 50, cursor });
      seen.push(...next.items);
      cursor = next.nextCursor;
    }
    expect(seen.map((o) => o.name)).toEqual(
      Array.from({ length: 60 }, (_, i) => `Org ${i + 1}`).sort(),
    );
    expect((await r.list({ limit: 50 })).items).toHaveLength(50);
    await expect(r.list({ limit: 51 })).rejects.toBeInstanceOf(ValidationError);
    await expect(r.list({ limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(r.list({ cursor: 'garbage' as never })).rejects.toBeInstanceOf(ValidationError);
  });

  it('has a null cursor on the last page', async () => {
    const r = new FakeOrganizationRepository();
    await r.create(org(1));
    expect((await r.list({ limit: 1 })).nextCursor).toBeNull();
  });
});

describe('FakeCertificateRepository', () => {
  it('rejects duplicate ids and orders by issuedAt descending', async () => {
    const r = new FakeCertificateRepository();
    await r.create(cert(2));
    await r.create(cert(3));
    await r.create(cert(1));
    await expect(r.create(cert(1))).rejects.toBeInstanceOf(ConflictError);
    const page = await r.list({});
    expect(page.items.map((c) => c.issuedAt.getUTCDate())).toEqual([3, 2, 1]);
  });

  it('filters by equality and a half-open issuedAt range, and counts', async () => {
    const r = new FakeCertificateRepository();
    await r.create(cert(1));
    await r.create(cert(2, { type: 'thanks' }));
    await r.create(cert(3));
    expect(await r.count({ type: 'attendance' })).toBe(2);
    expect(await r.count({ issuedFrom: day(2), issuedTo: day(3) })).toBe(1);
    expect(await r.count({ issuedFrom: day(4) })).toBe(0);
    expect(await r.countByTemplate(asTemplateRef('t-v1'))).toBe(3);
  });

  it('revokes once and reports missing ids', async () => {
    const r = new FakeCertificateRepository();
    await r.create(cert(1));
    expect((await r.markRevoked(cert(1).id, { reason: 'x', at: day(5) })).outcome).toBe('revoked');
    expect((await r.markRevoked(cert(1).id, { reason: 'y', at: day(6) })).outcome).toBe(
      'already_revoked',
    );
    expect((await r.getById(cert(1).id))?.status).toBe('revoked');
    expect((await r.markRevoked(cert(9).id, { reason: 'x', at: day(6) })).outcome).toBe(
      'not_found',
    );
  });
});
