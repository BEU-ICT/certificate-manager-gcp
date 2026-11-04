import { describe, expect, it } from 'vitest';
import type {
  Certificate,
  CertificateEvent,
  Organization,
  Template,
} from '../../../src/shared/domain.js';
import { ConflictError, ValidationError } from '../../../src/shared/errors.js';
import {
  asCertificateId,
  asEventId,
  asOrganizationId,
  asTemplateRef,
} from '../../../src/shared/ids.js';
import {
  FakeCertificateRepository,
  FakeEventRepository,
  FakeOrganizationRepository,
  FakeTemplateRepository,
} from '../../../src/testing/fakes/index.js';

const orgId = asOrganizationId('org1');
const evId = asEventId('ev1');
const day = (n: number) => new Date(Date.UTC(2026, 0, n));

const org = (n: number, slug = `org-${n}`): Organization => ({
  id: asOrganizationId(`org${n}`),
  slug,
  name: `Org ${n}`,
  createdAt: day(n),
});
const cert = (n: number, over: Partial<Certificate> = {}): Certificate => ({
  id: asCertificateId(String(n).padStart(22, 'a')),
  organizationId: orgId,
  eventId: evId,
  templateRef: asTemplateRef('t-v1'),
  type: 'attendance',
  status: 'valid',
  issuedAt: day(n),
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

  it('paginates newest first with opaque cursors, default 25 and max 50', async () => {
    const r = new FakeOrganizationRepository();
    for (let i = 1; i <= 60; i++) await r.create(org(i));
    const first = await r.list();
    expect(first.items).toHaveLength(25);
    expect(first.items[0]?.slug).toBe('org-60');
    const seen = [...first.items];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await r.list({ limit: 50, cursor });
      seen.push(...next.items);
      cursor = next.nextCursor;
    }
    expect(seen.map((o) => o.slug)).toEqual(Array.from({ length: 60 }, (_, i) => `org-${60 - i}`));
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

describe('FakeEventRepository', () => {
  const ev = (n: number, org: string, slug: string): CertificateEvent => ({
    id: asEventId(`ev${n}`),
    organizationId: asOrganizationId(org),
    slug,
    name: slug,
    createdAt: day(n),
  });

  it('scopes slug uniqueness to the organization', async () => {
    const r = new FakeEventRepository();
    await r.create(ev(1, 'o1', 'devfest'));
    await r.create(ev(2, 'o2', 'devfest'));
    await expect(r.create(ev(3, 'o1', 'devfest'))).rejects.toBeInstanceOf(ConflictError);
    expect((await r.getBySlug(asOrganizationId('o2'), 'devfest'))?.id).toBe('ev2');
    expect(await r.count()).toBe(2);
    expect(await r.count(asOrganizationId('o1'))).toBe(1);
  });

  it('lists by organization newest first', async () => {
    const r = new FakeEventRepository();
    await r.create(ev(1, 'o1', 'a'));
    await r.create(ev(2, 'o1', 'b'));
    await r.create(ev(3, 'o2', 'c'));
    const page = await r.listByOrganization(asOrganizationId('o1'));
    expect(page.items.map((e) => e.slug)).toEqual(['b', 'a']);
    expect(await r.getById(asEventId('ev3'))).not.toBeNull();
  });
});

describe('FakeTemplateRepository', () => {
  const tpl = (version: number, type = 'attendance'): Template => ({
    ref: asTemplateRef(`${type}-v${version}`),
    organizationId: orgId,
    eventId: evId,
    type,
    version,
    createdAt: day(version),
  });

  it('rejects duplicate references and finds the highest version', async () => {
    const r = new FakeTemplateRepository();
    await r.create(tpl(1));
    await r.create(tpl(3));
    await r.create(tpl(2));
    await r.create(tpl(1, 'thanks'));
    await expect(r.create(tpl(2))).rejects.toBeInstanceOf(ConflictError);
    expect((await r.getLatest(orgId, evId, 'attendance'))?.version).toBe(3);
    expect(await r.getLatest(orgId, evId, 'other')).toBeNull();
    expect((await r.getByRef(asTemplateRef('thanks-v1')))?.type).toBe('thanks');
    expect(await r.getByRef(asTemplateRef('zzz-v9'))).toBeNull();
    expect((await r.listByEvent(evId)).items).toHaveLength(4);
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

  it('filters by equality and inclusive ranges, and counts', async () => {
    const r = new FakeCertificateRepository();
    await r.create(cert(1));
    await r.create(cert(2, { type: 'thanks' }));
    await r.create(cert(3));
    expect(await r.count({ type: 'attendance' })).toBe(2);
    expect(await r.count({ issuedAt: { gte: day(2), lte: day(3) } })).toBe(2);
    expect(await r.count({ issuedAt: { gte: day(4) } })).toBe(0);
    expect(await r.count({ type: undefined })).toBe(3);
    expect((await r.list({ issuedAt: day(2) })).items).toHaveLength(1);
    await expect(r.count({ bogus: 1 })).rejects.toThrow(/Unknown certificate filter/);
  });

  it('revokes idempotently and reports missing ids', async () => {
    const r = new FakeCertificateRepository();
    await r.create(cert(1));
    expect(await r.revoke(cert(1).id, day(5))).toBe(true);
    expect(await r.revoke(cert(1).id, day(6))).toBe(true);
    expect((await r.getById(cert(1).id))?.status).toBe('revoked');
    expect(await r.revoke(cert(9).id, day(6))).toBe(false);
    expect(await r.getById(cert(9).id)).toBeNull();
  });
});
