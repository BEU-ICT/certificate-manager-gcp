import { describe, it } from 'vitest';
import type { OrganizationRepository } from '../../ports/index.js';
import type { Organization } from '../../shared/domain.js';
import { ConflictError, SlugTakenError, ValidationError } from '../../shared/errors.js';
import { asOrganizationId } from '../../shared/ids.js';
import { clause, type AdapterHandle, type ContractFactory } from './types.js';

const PORT = 'OrganizationRepository';

export type OrganizationRepositoryContractFactory = ContractFactory<OrganizationRepository>;

let counter = 0;
/** A valid organization; ids are 22-char base64url like the production ones. */
export function sampleOrganization(overrides: Partial<Organization> = {}): Organization {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  return {
    id: asOrganizationId(`org-${n}`.padEnd(22, 'x')),
    slug: `org-${n}`,
    name: `Organization ${n}`,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T10:00:00.000Z'),
    schemaVersion: 1,
    ...overrides,
  };
}

/** Executable form of the TSDoc on `OrganizationRepository` (src/ports/repositories.ts). */
export function describeOrganizationRepositoryContract(
  name: string,
  factory: OrganizationRepositoryContractFactory,
): void {
  const test = (title: string, body: (repo: OrganizationRepository) => Promise<void>) =>
    it(title, async () => {
      const handle: AdapterHandle<OrganizationRepository> = await factory();
      try {
        await body(handle.adapter);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`OrganizationRepository contract: ${name}`, () => {
    test('create then getById / getBySlug round-trips every field', async (repo) => {
      const org = sampleOrganization({ name: 'Əhməd Şəki' });
      await repo.create(org);
      clause(PORT, 'getById: returns the stored organization', 'by id')
        .that(await repo.getById(org.id))
        .toEqual(org);
      clause(PORT, 'getBySlug: returns the stored organization', 'by slug')
        .that(await repo.getBySlug(org.slug))
        .toEqual(org);
    });

    test('reads of a missing organization return null', async (repo) => {
      clause(PORT, 'getById: null when missing', 'unknown id')
        .that(await repo.getById(asOrganizationId('missing-id')))
        .toBeNull();
      clause(PORT, 'getBySlug: null when missing', 'unknown slug')
        .that(await repo.getBySlug('nope'))
        .toBeNull();
    });

    test('a taken slug fails with SlugTakenError and writes nothing', async (repo) => {
      const first = sampleOrganization({ slug: 'acme' });
      await repo.create(first);
      const second = sampleOrganization({ slug: 'acme' });
      await clause(
        PORT,
        'create: SlugTakenError when the slug is reserved',
        'same slug',
      ).rejectedWith(repo.create(second), SlugTakenError);
      clause(PORT, 'create: SlugTakenError is a ConflictError', 'type')
        .that(await repo.create(sampleOrganization({ slug: 'acme' })).catch((e: unknown) => e))
        .toBeInstanceOf(ConflictError);
      clause(PORT, 'create: nothing is written on conflict', 'second id')
        .that(await repo.getById(second.id))
        .toBeNull();
      clause(PORT, 'create: nothing is written on conflict', 'count')
        .that(await repo.count())
        .toBe(1);
    });

    test('a duplicate id fails with ConflictError', async (repo) => {
      const org = sampleOrganization();
      await repo.create(org);
      await clause(PORT, 'create: ConflictError when the id exists', 'same id').rejectedWith(
        repo.create({ ...org, slug: 'another-slug' }),
        ConflictError,
      );
    });

    test('parallel creates with one slug: exactly one succeeds', async (repo) => {
      const attempts = Array.from({ length: 8 }, () => sampleOrganization({ slug: 'race' }));
      const results = await Promise.allSettled(attempts.map((o) => repo.create(o)));
      clause(PORT, 'create: the slug reservation is atomic', 'fulfilled')
        .that(results.filter((r) => r.status === 'fulfilled'))
        .toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') {
          clause(PORT, 'create: losers get SlugTakenError', 'rejection')
            .that(r.reason)
            .toBeInstanceOf(SlugTakenError);
        }
      }
      clause(PORT, 'create: exactly one document exists', 'count')
        .that(await repo.count())
        .toBe(1);
    });

    test('list is ordered by name then id and paginates with an opaque cursor', async (repo) => {
      const names = ['Delta', 'alpha', 'Charlie', 'Bravo', 'Echo'];
      for (const n of names) await repo.create(sampleOrganization({ name: n }));
      await repo.create(sampleOrganization({ name: 'Bravo' })); // same name, ordered by id
      const seen: string[] = [];
      let cursor: Parameters<OrganizationRepository['list']>[0] = { limit: 2 };
      for (let i = 0; i < 10; i++) {
        const page = await repo.list(cursor);
        clause(PORT, 'list: a page never exceeds the limit', 'page size')
          .that(page.items.length <= 2)
          .toBe(true);
        seen.push(...page.items.map((o) => o.name));
        if (page.nextCursor === null) break;
        cursor = { limit: 2, cursor: page.nextCursor };
      }
      clause(PORT, 'list: ordered by name ascending (byte order), every item once', 'sequence')
        .that(seen)
        .toEqual(['Bravo', 'Bravo', 'Charlie', 'Delta', 'Echo', 'alpha']);
    });

    test('list defaults to 25 and rejects invalid limits and cursors', async (repo) => {
      for (let i = 0; i < 30; i++) await repo.create(sampleOrganization());
      const page = await repo.list();
      clause(PORT, 'list: default limit is 25', 'items').that(page.items).toHaveLength(25);
      clause(PORT, 'list: nextCursor is set while more items exist', 'cursor')
        .that(page.nextCursor)
        .not.toBeNull();
      for (const limit of [0, 51, 1.5]) {
        await clause(
          PORT,
          'list: limit must be an integer in 1..50',
          `limit ${String(limit)}`,
        ).rejectedWith(repo.list({ limit }), ValidationError);
      }
      await clause(PORT, 'list: an unusable cursor is a ValidationError', 'garbage').rejectedWith(
        repo.list({ cursor: 'not-a-cursor' as never }),
        ValidationError,
      );
    });

    test('updateName changes name and updatedAt only', async (repo) => {
      const org = sampleOrganization({ slug: 'keep-me' });
      await repo.create(org);
      const at = new Date('2026-02-02T08:30:00.000Z');
      const updated = await repo.updateName(org.id, 'Renamed', at);
      const expected = { ...org, name: 'Renamed', updatedAt: at };
      clause(PORT, 'updateName: returns the updated organization', 'result')
        .that(updated)
        .toEqual(expected);
      clause(PORT, 'updateName: slug and createdAt never change', 'stored')
        .that(await repo.getById(org.id))
        .toEqual(expected);
      clause(PORT, 'updateName: the slug stays reserved', 'getBySlug')
        .that((await repo.getBySlug('keep-me'))?.id)
        .toBe(org.id);
    });

    test('updateName of a missing organization returns null', async (repo) => {
      clause(PORT, 'updateName: null when missing', 'unknown id')
        .that(await repo.updateName(asOrganizationId('missing-id'), 'x', new Date()))
        .toBeNull();
    });

    test('delete removes the organization and releases the slug', async (repo) => {
      const org = sampleOrganization({ slug: 'reuse' });
      await repo.create(org);
      clause(PORT, 'delete: true when something was deleted', 'first delete')
        .that(await repo.delete(org.id))
        .toBe(true);
      clause(PORT, 'delete: false when missing', 'second delete')
        .that(await repo.delete(org.id))
        .toBe(false);
      clause(PORT, 'delete: the document is gone', 'getById')
        .that(await repo.getById(org.id))
        .toBeNull();
      const again = sampleOrganization({ slug: 'reuse' });
      await clause(PORT, 'delete: the slug can be created again', 'recreate').resolved(
        repo.create(again),
      );
    });

    test('getMany returns the existing organizations among the ids', async (repo) => {
      const a = sampleOrganization();
      const b = sampleOrganization();
      await repo.create(a);
      await repo.create(b);
      const found = await repo.getMany([a.id, asOrganizationId('missing-id'), b.id]);
      clause(PORT, 'getMany: only existing organizations', 'ids')
        .that(found.map((o) => o.id).sort())
        .toEqual([a.id, b.id].sort());
      clause(PORT, 'getMany: empty input gives empty output', 'no ids')
        .that(await repo.getMany([]))
        .toEqual([]);
    });
  });
}
