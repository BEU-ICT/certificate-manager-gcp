import { beforeEach, describe, expect, it } from 'vitest';
import { buildServices } from '../../src/services.js';
import {
  InUseError,
  NotFoundError,
  SlugTakenError,
  ValidationError,
} from '../../src/shared/errors.js';
import { sampleCertificate } from '../../src/testing/contracts/index.js';
import { createFakes } from '../../src/testing/fakes/create-fakes.js';

async function setup() {
  const fakes = createFakes();
  const services = buildServices(fakes);
  const org = await services.organizations.create({ name: 'Acme' });
  const other = await services.organizations.create({ name: 'Other' });
  return { fakes, services, events: services.events, org, other };
}

describe('EventService', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('creates with a generated slug and the default e-mail language', async () => {
    const event = await ctx.events.create({ organizationId: ctx.org.id, name: 'DevFest 2026' });
    expect(event).toMatchObject({
      organizationId: ctx.org.id,
      name: 'DevFest 2026',
      slug: 'devfest-2026',
      emailLanguage: 'az',
      schemaVersion: 1,
    });
    expect(event.id).toHaveLength(22);
  });

  it('accepts an English e-mail language and rejects others', async () => {
    const event = await ctx.events.create({
      organizationId: ctx.org.id,
      name: 'Summit',
      emailLanguage: 'en',
    });
    expect(event.emailLanguage).toBe('en');
    await expect(
      ctx.events.create({ organizationId: ctx.org.id, name: 'X1', emailLanguage: 'ru' as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a missing organization is a 404 pointing at organizationId', async () => {
    for (const organizationId of ['missing-org', '../bad']) {
      const error = await ctx.events
        .create({ organizationId, name: 'Summit' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).details).toEqual([
        { path: 'organizationId', message: 'NOT_FOUND' },
      ]);
    }
  });

  it('slugs are unique within an organization with a suggestion, free in another one', async () => {
    await ctx.events.create({ organizationId: ctx.org.id, name: 'DevFest 2026' });
    const error = await ctx.events
      .create({ organizationId: ctx.org.id, name: 'DevFest 2026' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SlugTakenError);
    expect((error as SlugTakenError).details).toEqual([
      { path: 'slug', message: 'SLUG_TAKEN', suggestion: 'devfest-2026-2' },
    ]);
    const elsewhere = await ctx.events.create({
      organizationId: ctx.other.id,
      name: 'DevFest 2026',
    });
    expect(elsewhere.slug).toBe('devfest-2026');
  });

  it('parallel creates of one slug: one winner', async () => {
    const results = await Promise.allSettled([
      ctx.events.create({ organizationId: ctx.org.id, name: 'Race' }),
      ctx.events.create({ organizationId: ctx.org.id, name: 'Race' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('update changes name and/or language, never the slug; empty updates are rejected', async () => {
    const event = await ctx.events.create({ organizationId: ctx.org.id, name: 'DevFest' });
    ctx.fakes.clock.advance(1000);
    const updated = await ctx.events.update(event.id, {
      name: 'DevFest 2026',
      emailLanguage: 'en',
    });
    expect(updated).toMatchObject({ slug: 'devfest', name: 'DevFest 2026', emailLanguage: 'en' });
    expect(updated.organizationId).toBe(ctx.org.id);
    expect(updated.updatedAt.getTime()).toBe(event.createdAt.getTime() + 1000);
    await expect(ctx.events.update(event.id, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(ctx.events.update('missing-id', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('list filters by organization, newest first', async () => {
    const first = await ctx.events.create({ organizationId: ctx.org.id, name: 'First' });
    ctx.fakes.clock.advance(1000);
    const second = await ctx.events.create({ organizationId: ctx.org.id, name: 'Second' });
    await ctx.events.create({ organizationId: ctx.other.id, name: 'Elsewhere' });
    const page = await ctx.events.list({ organizationId: ctx.org.id });
    expect(page.items.map((e) => e.id)).toEqual([second.id, first.id]);
    expect((await ctx.events.list({ organizationId: '../bad' })).items).toEqual([]);
  });

  it('delete is blocked while templates or certificates reference the event', async () => {
    const event = await ctx.events.create({ organizationId: ctx.org.id, name: 'DevFest' });
    // The `templates` and `certificates` checkers are registered by buildServices.
    for (let i = 0; i < 3; i++) {
      await ctx.fakes.certificates.create(
        sampleCertificate({ organizationId: ctx.org.id, eventId: event.id }),
      );
    }
    const error = await ctx.events.delete(event.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InUseError);
    expect((error as InUseError).details).toEqual([
      { path: 'references', message: 'IN_USE', counts: { templates: 0, certificates: 3 } },
    ]);
  });

  it('delete works when unreferenced and frees the slug; snapshot and exists behave', async () => {
    const event = await ctx.events.create({ organizationId: ctx.org.id, name: 'DevFest' });
    expect(await ctx.events.getSnapshot(event.id)).toEqual({
      id: event.id,
      name: 'DevFest',
      organizationId: ctx.org.id,
    });
    await ctx.events.delete(event.id);
    expect(await ctx.events.exists(event.id)).toBe(false);
    await expect(ctx.events.getSnapshot(event.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await ctx.events.create({ organizationId: ctx.org.id, name: 'DevFest' })).slug).toBe(
      'devfest',
    );
  });

  it('events block deleting their organization (EventsByOrganization checker)', async () => {
    await ctx.events.create({ organizationId: ctx.org.id, name: 'DevFest' });
    const error = await ctx.services.organizations.delete(ctx.org.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InUseError);
    expect((error as InUseError).details).toEqual([
      { path: 'references', message: 'IN_USE', counts: { events: 1, templates: 0, certificates: 0 } },
    ]);
    await expect(ctx.services.organizations.delete(ctx.other.id)).resolves.toBeUndefined();
  });
});
