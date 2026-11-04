import { describe, it } from 'vitest';
import type { StorageGateway } from '../../ports/index.js';
import { NotFoundError } from '../../shared/errors.js';
import { clause, withAdapter, type ContractFactory } from './types.js';

const PORT = 'StorageGateway';
const options = { contentType: 'application/pdf' };
const bytes = (value: string) => Buffer.from(value);
const str = (body: Buffer | null) => body?.toString();

const PUT = 'put: Creates or overwrites the object';
const PUT_IF_ABSENT = 'putIfAbsent: Creates the object only if absent';
const RACE = 'putIfAbsent: Exactly one of concurrent callers gets created: true';
const GET = 'get: null when the object does not exist';
const DELETE = 'delete: A missing object counts as success';
const COPY = 'copy: Fails with NotFoundError when fromKey is missing; overwrites toKey';
const LIST = 'list: Keys starting with prefix, lexicographic order';

/** Executable form of the TSDoc on `StorageGateway` (src/ports/storage-gateway.ts). */
export function describeStorageGatewayContract(
  name: string,
  factory: ContractFactory<StorageGateway>,
): void {
  const test = (title: string, body: (storage: StorageGateway) => Promise<void> | void) =>
    it(title, () => withAdapter(factory, body));

  describe(`StorageGateway contract: ${name}`, () => {
    test('put creates the object and overwrites an existing one', async (s) => {
      await s.put('pdfs', 'a/b.pdf', bytes('one'), options);
      clause(PORT, PUT, 'create')
        .that(str(await s.get('pdfs', 'a/b.pdf')))
        .toBe('one');
      await s.put('pdfs', 'a/b.pdf', bytes('two'), options);
      clause(PORT, PUT, 'overwrite')
        .that(str(await s.get('pdfs', 'a/b.pdf')))
        .toBe('two');
    });

    test('get returns null for a missing object', async (s) => {
      clause(PORT, GET, 'unknown key')
        .that(await s.get('pdfs', 'missing.pdf'))
        .toBeNull();
    });

    test('BucketKind values are separate logical buckets', async (s) => {
      await s.put('pdfs', 'k', bytes('x'), options);
      clause(PORT, 'BucketKind: Logical bucket', 'same key under another kind')
        .that(await s.get('templates', 'k'))
        .toBeNull();
    });

    test('putIfAbsent creates a missing object and keeps an existing one', async (s) => {
      clause(PORT, PUT_IF_ABSENT, 'first call must create')
        .that(await s.putIfAbsent('pdfs', 'k', bytes('first'), options))
        .toEqual({ created: true });
      clause(PORT, PUT_IF_ABSENT, 'second call must not create')
        .that(await s.putIfAbsent('pdfs', 'k', bytes('second'), options))
        .toEqual({ created: false });
      clause(PORT, PUT_IF_ABSENT, 'existing content must be kept')
        .that(str(await s.get('pdfs', 'k')))
        .toBe('first');
    });

    test('putIfAbsent lets exactly one concurrent caller create', async (s) => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => s.putIfAbsent('pdfs', 'race', bytes(`${i}`), options)),
      );
      const winners = results.flatMap((r, i) => (r.created ? [i] : []));
      clause(PORT, RACE, `callers with created: true: [${winners.join(', ')}]`)
        .that(winners)
        .toHaveLength(1);
      clause(PORT, RACE, 'stored body must belong to the winner')
        .that(str(await s.get('pdfs', 'race')))
        .toBe(String(winners[0]));
    });

    test('delete removes the object and treats a missing object as success', async (s) => {
      await s.put('pdfs', 'k', bytes('x'), options);
      await s.delete('pdfs', 'k');
      clause(PORT, 'delete: removes the object', 'get after delete')
        .that(await s.get('pdfs', 'k'))
        .toBeNull();
      await clause(PORT, DELETE, 'deleting twice').resolved(s.delete('pdfs', 'k'));
      await clause(PORT, DELETE, 'key that never existed').resolved(
        s.delete('pdfs', 'never-existed'),
      );
    });

    test('copy duplicates the object and overwrites the target', async (s) => {
      await s.put('pdfs', 'from', bytes('source'), options);
      await s.put('pdfs', 'to', bytes('old target'), options);
      await s.copy('pdfs', 'from', 'to');
      clause(PORT, COPY, 'toKey must be overwritten with the source body')
        .that(str(await s.get('pdfs', 'to')))
        .toBe('source');
      clause(PORT, COPY, 'copy must not remove the source')
        .that(str(await s.get('pdfs', 'from')))
        .toBe('source');
    });

    test('copy of a missing object fails with NotFoundError', async (s) => {
      await clause(PORT, COPY, 'missing fromKey must reject with NotFoundError').rejectedWith(
        s.copy('pdfs', 'missing', 'to'),
        NotFoundError,
      );
      clause(PORT, COPY, 'a failed copy must not create toKey')
        .that(await s.get('pdfs', 'to'))
        .toBeNull();
    });

    test('list returns keys starting with the prefix in lexicographic order', async (s) => {
      for (const key of ['b/2', 'a/2', 'a/1', 'ab', 'c/1']) {
        await s.put('pdfs', key, bytes(key), options);
      }
      await s.put('templates', 'a/other-bucket', bytes('x'), options);
      clause(PORT, LIST, 'prefix "a/"')
        .that(await s.list('pdfs', 'a/'))
        .toEqual(['a/1', 'a/2']);
      clause(PORT, LIST, 'prefix "a"')
        .that(await s.list('pdfs', 'a'))
        .toEqual(['a/1', 'a/2', 'ab']);
      clause(PORT, LIST, 'empty prefix lists the whole bucket only')
        .that(await s.list('pdfs', ''))
        .toEqual(['a/1', 'a/2', 'ab', 'b/2', 'c/1']);
      clause(PORT, LIST, 'prefix without matches')
        .that(await s.list('pdfs', 'zzz'))
        .toEqual([]);
    });

    test('publicUrl is pure and mentions the key', (s) => {
      const url = s.publicUrl('certs/abc.pdf');
      clause(PORT, 'publicUrl: Public URL of a PDF key', 'must contain the key')
        .that(url)
        .toContain('certs/abc.pdf');
      clause(PORT, 'publicUrl: pure, performs no I/O', 'same input, same output')
        .that(s.publicUrl('certs/abc.pdf'))
        .toBe(url);
    });
  });
}
