import { describe, it } from 'vitest';
import type { TemplateFilter, TemplateRepository } from '../../ports/index.js';
import type { Template } from '../../shared/domain.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import { asEventId, asOrganizationId, asTemplateRef } from '../../shared/ids.js';
import { clause, type AdapterHandle, type ContractFactory } from './types.js';

const PORT = 'TemplateRepository';

export type TemplateRepositoryContractFactory = ContractFactory<TemplateRepository>;

export const TPL_ORG = asOrganizationId('org-a'.padEnd(22, 'x'));
export const TPL_EVENT = asEventId('evt-a'.padEnd(22, 'x'));
const OTHER_EVENT = asEventId('evt-b'.padEnd(22, 'x'));
const OTHER_ORG = asOrganizationId('org-b'.padEnd(22, 'x'));

let counter = 0;
/** A valid template; every call gets a later `createdAt` unless overridden. */
export function sampleTemplate(overrides: Partial<Template> = {}): Template {
  counter += 1;
  const type = overrides.type ?? 'attendance';
  const version = overrides.version ?? 0;
  const organizationSlug = overrides.organizationSlug ?? 'acme';
  const eventSlug = overrides.eventSlug ?? 'devfest';
  const reference =
    overrides.reference ??
    asTemplateRef(`${organizationSlug}-${eventSlug}-${type}-v${String(version)}`);
  return {
    reference,
    organizationId: TPL_ORG,
    eventId: TPL_EVENT,
    organizationSlug,
    eventSlug,
    type,
    version,
    storagePath: `templates/${reference}/`,
    config: { page: { size: 'A4' }, fields: { ownerName: { x: 1, y: 2, nested: [1, 'a', true] } } },
    createdAt: new Date(Date.UTC(2026, 0, 1, 10, 0, 0) + counter * 1000),
    createdBy: 'admin-1',
    schemaVersion: 1,
    ...overrides,
  };
}

/** Executable form of the TSDoc on `TemplateRepository` (src/ports/repositories.ts). */
export function describeTemplateRepositoryContract(
  name: string,
  factory: TemplateRepositoryContractFactory,
): void {
  const test = (title: string, body: (repo: TemplateRepository) => Promise<void>) =>
    it(title, async () => {
      const handle: AdapterHandle<TemplateRepository> = await factory();
      try {
        await body(handle.adapter);
      } finally {
        await handle.cleanup();
      }
    });

  describe(`TemplateRepository contract: ${name}`, () => {
    test('create then getByReference round-trips every field', async (repo) => {
      const template = sampleTemplate({ version: 3 });
      await repo.create(template);
      clause(PORT, 'getByReference: returns the stored template', 'by reference')
        .that(await repo.getByReference(template.reference))
        .toEqual(template);
      clause(PORT, 'getByReference: null when missing', 'unknown')
        .that(await repo.getByReference(asTemplateRef('nobody-v0')))
        .toBeNull();
    });

    test('a duplicate reference fails with ConflictError and changes nothing', async (repo) => {
      const template = sampleTemplate();
      await repo.create(template);
      await clause(PORT, 'create: ConflictError when the reference exists', 'same').rejectedWith(
        repo.create({ ...template, createdBy: 'someone-else' }),
        ConflictError,
      );
      clause(PORT, 'create: the stored template is never overwritten', 'createdBy')
        .that((await repo.getByReference(template.reference))?.createdBy)
        .toBe('admin-1');
    });

    test('parallel creates of one reference: exactly one succeeds', async (repo) => {
      const attempts = Array.from({ length: 8 }, (_, i) =>
        sampleTemplate({ createdBy: `a${String(i)}` }),
      );
      const results = await Promise.allSettled(attempts.map((t) => repo.create(t)));
      clause(PORT, 'create: exactly one concurrent caller wins', 'fulfilled')
        .that(results.filter((r) => r.status === 'fulfilled'))
        .toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') {
          clause(PORT, 'create: losers get ConflictError', 'rejection')
            .that(r.reason)
            .toBeInstanceOf(ConflictError);
        }
      }
      clause(PORT, 'create: one document exists', 'count')
        .that(await repo.count())
        .toBe(1);
    });

    test('getLatest and maxVersion follow the highest version of the triple', async (repo) => {
      clause(PORT, 'maxVersion: null without versions', 'empty')
        .that(await repo.maxVersion(TPL_ORG, TPL_EVENT, 'attendance'))
        .toBeNull();
      clause(PORT, 'getLatest: null without versions', 'empty')
        .that(await repo.getLatest(TPL_ORG, TPL_EVENT, 'attendance'))
        .toBeNull();
      for (const version of [1, 0, 10, 2]) await repo.create(sampleTemplate({ version }));
      await repo.create(sampleTemplate({ type: 'thanks', version: 4 }));
      await repo.create(sampleTemplate({ eventSlug: 'other', eventId: OTHER_EVENT, version: 7 }));
      clause(PORT, 'maxVersion: numeric, not lexicographic, per triple', 'attendance')
        .that(await repo.maxVersion(TPL_ORG, TPL_EVENT, 'attendance'))
        .toBe(10);
      clause(PORT, 'getLatest: the highest version', 'attendance')
        .that((await repo.getLatest(TPL_ORG, TPL_EVENT, 'attendance'))?.reference)
        .toBe('acme-devfest-attendance-v10');
      clause(PORT, 'maxVersion: other types are independent', 'thanks')
        .that(await repo.maxVersion(TPL_ORG, TPL_EVENT, 'thanks'))
        .toBe(4);
      clause(PORT, 'maxVersion: other events are independent', 'event b')
        .that(await repo.maxVersion(TPL_ORG, OTHER_EVENT, 'attendance'))
        .toBe(7);
      clause(PORT, 'maxVersion: other organizations are independent', 'org b')
        .that(await repo.maxVersion(OTHER_ORG, TPL_EVENT, 'attendance'))
        .toBeNull();
    });

    test('list is newest first, filters and paginates', async (repo) => {
      const mine = [0, 1, 2, 3, 4].map((version) => sampleTemplate({ version }));
      const thanks = sampleTemplate({ type: 'thanks' });
      const other = sampleTemplate({
        eventSlug: 'other',
        eventId: OTHER_EVENT,
        organizationId: OTHER_ORG,
      });
      for (const t of [...mine, thanks, other]) await repo.create(t);
      const collect = async (filter: TemplateFilter) => {
        const seen: string[] = [];
        let page: Parameters<TemplateRepository['list']>[1] = { limit: 2 };
        for (let i = 0; i < 10; i++) {
          const result = await repo.list(filter, page);
          seen.push(...result.items.map((t) => t.reference));
          if (result.nextCursor === null) break;
          page = { limit: 2, cursor: result.nextCursor };
        }
        return seen;
      };
      clause(PORT, 'list: newest first, every item once', 'no filter')
        .that(await collect({}))
        .toEqual([other, thanks, ...[...mine].reverse()].map((t) => t.reference));
      clause(PORT, 'list: filtered by event', 'eventId')
        .that(await collect({ eventId: TPL_EVENT }))
        .toEqual([thanks, ...[...mine].reverse()].map((t) => t.reference));
      clause(PORT, 'list: filtered by organization', 'organizationId')
        .that(await collect({ organizationId: OTHER_ORG }))
        .toEqual([other.reference]);
      clause(PORT, 'list: filters combine', 'event + type')
        .that(await collect({ eventId: TPL_EVENT, type: 'attendance' }))
        .toEqual([...mine].reverse().map((t) => t.reference));
    });

    test('list defaults to 25 and rejects invalid limits and cursors', async (repo) => {
      for (let i = 0; i < 30; i++) await repo.create(sampleTemplate({ version: i }));
      clause(PORT, 'list: default limit is 25', 'items')
        .that((await repo.list()).items)
        .toHaveLength(25);
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

    test('count honours the filter', async (repo) => {
      await repo.create(sampleTemplate({ version: 0 }));
      await repo.create(sampleTemplate({ version: 1 }));
      await repo.create(
        sampleTemplate({ eventSlug: 'other', eventId: OTHER_EVENT, organizationId: OTHER_ORG }),
      );
      clause(PORT, 'count: all', 'total')
        .that(await repo.count())
        .toBe(3);
      clause(PORT, 'count: by event', 'event')
        .that(await repo.count({ eventId: TPL_EVENT }))
        .toBe(2);
      clause(PORT, 'count: by organization', 'org')
        .that(await repo.count({ organizationId: OTHER_ORG }))
        .toBe(1);
      clause(PORT, 'count: zero when nothing matches', 'none')
        .that(await repo.count({ type: 'team' }))
        .toBe(0);
    });
  });
}
