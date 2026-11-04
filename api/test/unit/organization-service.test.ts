import { beforeEach, describe, expect, it } from 'vitest';
import {
  DefaultOrganizationService,
  ReferenceCheckRegistry,
} from '../../src/modules/organizations/index.js';
import {
  InUseError,
  NotFoundError,
  SlugTakenError,
  ValidationError,
} from '../../src/shared/errors.js';
import { createFakes } from '../../src/testing/fakes/create-fakes.js';

function setup() {
  const fakes = createFakes();
  const references = new ReferenceCheckRegistry();
  const service = new DefaultOrganizationService(
    fakes.organizations,
    fakes.clock,
    fakes.ids,
    references,
  );
  return { fakes, references, service };
}

describe('OrganizationService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creates with a slug generated from an Azerbaijani name', async () => {
    const org = await ctx.service.create({ name: '  Azərbaycan   Texniki Universiteti ' });
    expect(org.name).toBe('Azərbaycan Texniki Universiteti');
    expect(org.slug).toBe('azerbaycan-texniki-universiteti');
    expect(org.id).toHaveLength(22);
    expect(org.createdAt).toEqual(org.updatedAt);
    expect(org.schemaVersion).toBe(1);
  });

  it('uses a provided slug and validates it', async () => {
    expect((await ctx.service.create({ name: 'BEU', slug: 'beu-ict' })).slug).toBe('beu-ict');
    await expect(ctx.service.create({ name: 'X', slug: 'Not Valid' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects names that give no slug and invalid names', async () => {
    await expect(ctx.service.create({ name: '🎉🎉' })).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.service.create({ name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.service.create({ name: 'a'.repeat(121) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(ctx.service.create({ name: 'bad\u0000name' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('a taken slug yields SLUG_TAKEN with the next free suggestion, never a silent suffix', async () => {
    await ctx.service.create({ name: 'Acme' });
    await ctx.service.create({ name: 'Other', slug: 'acme-2' });
    const error = await ctx.service.create({ name: 'Acme' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SlugTakenError);
    expect((error as SlugTakenError).details).toEqual([
      { path: 'slug', message: 'SLUG_TAKEN', suggestion: 'acme-3' },
    ]);
    expect(await ctx.fakes.organizations.count()).toBe(2);
  });

  it('two parallel creates with the same slug: one wins, one gets SLUG_TAKEN', async () => {
    const results = await Promise.allSettled([
      ctx.service.create({ name: 'Acme' }),
      ctx.service.create({ name: 'ACME' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected');
    expect(lost?.status === 'rejected' && lost.reason).toBeInstanceOf(SlugTakenError);
  });

  it('rename changes only the name and updatedAt', async () => {
    const org = await ctx.service.create({ name: 'Acme' });
    ctx.fakes.clock.advance(60_000);
    const renamed = await ctx.service.rename(org.id, 'Acme Corporation');
    expect(renamed).toMatchObject({ id: org.id, slug: 'acme', name: 'Acme Corporation' });
    expect(renamed.createdAt).toEqual(org.createdAt);
    expect(renamed.updatedAt.getTime()).toBe(org.createdAt.getTime() + 60_000);
    expect(await ctx.service.getSnapshotName(org.id)).toBe('Acme Corporation');
  });

  it('get, rename and delete of unknown or malformed ids are NotFound', async () => {
    for (const id of ['missing-id', 'has space', '../etc', '']) {
      await expect(ctx.service.get(id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.service.rename(id, 'x')).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.service.delete(id)).rejects.toBeInstanceOf(NotFoundError);
      expect(await ctx.service.exists(id)).toBe(false);
    }
  });

  it('delete is blocked while any registered checker reports references, with counts', async () => {
    const org = await ctx.service.create({ name: 'Acme' });
    ctx.references.register({ name: 'events', countReferences: () => Promise.resolve(2) });
    ctx.references.register({ name: 'certificates', countReferences: () => Promise.resolve(0) });
    const error = await ctx.service.delete(org.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InUseError);
    expect((error as InUseError).details).toEqual([
      { path: 'references', message: 'IN_USE', counts: { events: 2, certificates: 0 } },
    ]);
    expect(await ctx.service.exists(org.id)).toBe(true);
  });

  it('delete succeeds when unreferenced and the slug can be reused', async () => {
    const org = await ctx.service.create({ name: 'Acme' });
    ctx.references.register({ name: 'events', countReferences: () => Promise.resolve(0) });
    await ctx.service.delete(org.id);
    expect(await ctx.service.exists(org.id)).toBe(false);
    expect((await ctx.service.create({ name: 'Acme' })).slug).toBe('acme');
  });

  it('getNames resolves existing organizations in one batch and ignores unknown ids', async () => {
    const a = await ctx.service.create({ name: 'Alpha' });
    const b = await ctx.service.create({ name: 'Beta' });
    const names = await ctx.service.getNames([a.id, b.id, 'missing-id', '../bad']);
    expect([...names]).toEqual([
      [a.id, 'Alpha'],
      [b.id, 'Beta'],
    ]);
  });

  it('refuses two reference checkers with one name', () => {
    ctx.references.register({ name: 'events', countReferences: () => Promise.resolve(0) });
    expect(() =>
      ctx.references.register({ name: 'events', countReferences: () => Promise.resolve(0) }),
    ).toThrow(/already registered/);
  });
});
