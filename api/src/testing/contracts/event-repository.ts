import { describe, it } from 'vitest';
import type { EventRepository } from '../../ports/index.js';
import type { CertificateEvent } from '../../shared/domain.js';
import { ConflictError, SlugTakenError, ValidationError } from '../../shared/errors.js';
import { asEventId, asOrganizationId, type OrganizationId } from '../../shared/ids.js';
import { clause, type AdapterHandle, type ContractFactory } from './types.js';

const PORT = 'EventRepository';

export type EventRepositoryContractFactory = ContractFactory<EventRepository>;

export const ORG_A = asOrganizationId('org-a'.padEnd(22, 'x'));
export const ORG_B = asOrganizationId('org-b'.padEnd(22, 'x'));

let counter = 0;
/** A valid event; every call gets a fresh id and slug and a later `createdAt`. */
export function sampleEvent(overrides: Partial<CertificateEvent> = {}): CertificateEvent {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  const createdAt = new Date(Date.UTC(2026, 0, 1, 10, 0, 0) + counter * 1000);
  return {
    id: asEventId(`evt-${n}`.padEnd(22, 'x')),
    organizationId: ORG_A,
    slug: `event-${n}`,
    name: `Event ${n}`,
    emailLanguage: 'az',
    createdAt,
    updatedAt: createdAt,
    schemaVersion: 1,
    ...overrides,
  };
}

/** Executable form of the TSDoc on `EventRepository` (src/ports/repositories.ts). */
export function describeEventRepositoryContract(
  name: string,
  factory: EventRepositoryContractFactory,
): void {
  const test = (title: string, body: (repo: EventRepository) => Promise<void>) =>
    it(title, async () => {
      const handle: AdapterHandle<EventRepository> = await factory();
      try {
        await body(handle.adapter);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`EventRepository contract: ${name}`, () => {
    test('create then getById / getBySlug round-trips every field', async (repo) => {
      const event = sampleEvent({ emailLanguage: 'en' });
      await repo.create(event);
      clause(PORT, 'getById: returns the stored event', 'by id')
        .that(await repo.getById(event.id))
        .toEqual(event);
      clause(PORT, 'getBySlug: returns the event of that organization', 'by slug')
        .that(await repo.getBySlug(event.organizationId, event.slug))
        .toEqual(event);
      clause(PORT, 'getBySlug: slugs are scoped to the organization', 'other organization')
        .that(await repo.getBySlug(ORG_B, event.slug))
        .toBeNull();
    });

    test('reads of a missing event return null', async (repo) => {
      clause(PORT, 'getById: null when missing', 'unknown id')
        .that(await repo.getById(asEventId('missing-id')))
        .toBeNull();
    });

    test('the same slug is allowed in another organization, rejected in the same one', async (repo) => {
      await repo.create(sampleEvent({ slug: 'devfest-2026' }));
      await clause(PORT, 'create: SlugTakenError within the organization', 'same org').rejectedWith(
        repo.create(sampleEvent({ slug: 'devfest-2026' })),
        SlugTakenError,
      );
      await clause(
        PORT,
        'create: the same slug is free in another organization',
        'other org',
      ).resolved(repo.create(sampleEvent({ slug: 'devfest-2026', organizationId: ORG_B })));
      clause(PORT, 'create: nothing is written on conflict', 'count')
        .that(await repo.count())
        .toBe(2);
    });

    test('a duplicate id fails with ConflictError', async (repo) => {
      const event = sampleEvent();
      await repo.create(event);
      await clause(PORT, 'create: ConflictError when the id exists', 'same id').rejectedWith(
        repo.create({ ...event, slug: 'another-slug' }),
        ConflictError,
      );
    });

    test('parallel creates with one slug: exactly one succeeds', async (repo) => {
      const attempts = Array.from({ length: 8 }, () => sampleEvent({ slug: 'race' }));
      const results = await Promise.allSettled(attempts.map((e) => repo.create(e)));
      clause(PORT, 'create: the slug reservation is atomic', 'fulfilled')
        .that(results.filter((r) => r.status === 'fulfilled'))
        .toHaveLength(1);
      clause(PORT, 'create: exactly one document exists', 'count')
        .that(await repo.count())
        .toBe(1);
    });

    test('list is newest first, filters by organization and paginates', async (repo) => {
      const a = [1, 2, 3, 4, 5].map(() => sampleEvent());
      const b = [1, 2].map(() => sampleEvent({ organizationId: ORG_B }));
      for (const e of [...a, ...b]) await repo.create(e);
      const collect = async (organizationId?: OrganizationId) => {
        const seen: string[] = [];
        let page: Parameters<EventRepository['list']>[1] = { limit: 2 };
        for (let i = 0; i < 10; i++) {
          const result = await repo.list(organizationId ? { organizationId } : {}, page);
          seen.push(...result.items.map((e) => e.id));
          if (result.nextCursor === null) break;
          page = { limit: 2, cursor: result.nextCursor };
        }
        return seen;
      };
      clause(PORT, 'list: newest first, filtered by organization, every item once', 'org A')
        .that(await collect(ORG_A))
        .toEqual([...a].reverse().map((e) => e.id));
      clause(PORT, 'list: without a filter all organizations are listed', 'all')
        .that(await collect())
        .toEqual([...a, ...b].reverse().map((e) => e.id));
    });

    test('list defaults to 25 and rejects invalid limits and cursors', async (repo) => {
      for (let i = 0; i < 30; i++) await repo.create(sampleEvent());
      const page = await repo.list();
      clause(PORT, 'list: default limit is 25', 'items').that(page.items).toHaveLength(25);
      for (const limit of [0, 51]) {
        await clause(
          PORT,
          'list: limit must be an integer in 1..50',
          `limit ${String(limit)}`,
        ).rejectedWith(repo.list({}, { limit }), ValidationError);
      }
      await clause(PORT, 'list: an unusable cursor is a ValidationError', 'garbage').rejectedWith(
        repo.list({}, { cursor: 'not-a-cursor' as never }),
        ValidationError,
      );
    });

    test('update changes only the given fields and updatedAt', async (repo) => {
      const event = sampleEvent({ slug: 'keep-me' });
      await repo.create(event);
      const at1 = new Date('2026-03-01T00:00:00.000Z');
      const renamed = await repo.update(event.id, { name: 'Renamed' }, at1);
      clause(PORT, 'update: only the name changes', 'rename')
        .that(renamed)
        .toEqual({ ...event, name: 'Renamed', updatedAt: at1 });
      const at2 = new Date('2026-03-02T00:00:00.000Z');
      const relanguaged = await repo.update(event.id, { emailLanguage: 'en' }, at2);
      clause(PORT, 'update: only the e-mail language changes', 'language')
        .that(relanguaged)
        .toEqual({ ...event, name: 'Renamed', emailLanguage: 'en', updatedAt: at2 });
      clause(PORT, 'update: slug and organization never change', 'stored')
        .that(await repo.getById(event.id))
        .toEqual(relanguaged);
      clause(PORT, 'update: the slug stays reserved', 'getBySlug')
        .that((await repo.getBySlug(event.organizationId, 'keep-me'))?.id)
        .toBe(event.id);
    });

    test('update of a missing event returns null', async (repo) => {
      clause(PORT, 'update: null when missing', 'unknown id')
        .that(await repo.update(asEventId('missing-id'), { name: 'x' }, new Date()))
        .toBeNull();
    });

    test('delete removes the event and releases its slug', async (repo) => {
      const event = sampleEvent({ slug: 'reuse' });
      await repo.create(event);
      clause(PORT, 'delete: true when something was deleted', 'first')
        .that(await repo.delete(event.id))
        .toBe(true);
      clause(PORT, 'delete: false when missing', 'second')
        .that(await repo.delete(event.id))
        .toBe(false);
      await clause(PORT, 'delete: the slug can be created again', 'recreate').resolved(
        repo.create(sampleEvent({ slug: 'reuse' })),
      );
    });

    test('count can be limited to an organization', async (repo) => {
      await repo.create(sampleEvent());
      await repo.create(sampleEvent());
      await repo.create(sampleEvent({ organizationId: ORG_B }));
      clause(PORT, 'count: all events', 'total')
        .that(await repo.count())
        .toBe(3);
      clause(PORT, 'count: events of one organization', 'org A')
        .that(await repo.count(ORG_A))
        .toBe(2);
      clause(PORT, 'count: zero for an organization without events', 'unknown')
        .that(await repo.count(asOrganizationId('nobody')))
        .toBe(0);
    });
  });
}
