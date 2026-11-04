import { describe, expect, it } from 'vitest';
import type { StorageGateway } from '../../../src/ports/index.js';
import { NotFoundError, UnavailableError } from '../../../src/shared/errors.js';
import { FakeStorageGateway } from '../../../src/testing/fakes/index.js';

const opts = { contentType: 'application/pdf' };
const buf = (s: string) => Buffer.from(s);

/** Reusable behaviours every StorageGateway must show. */
export function storageGatewayBehaviour(make: () => StorageGateway): void {
  it('stores, reads back and overwrites', async () => {
    const s = make();
    await s.put('pdfs', 'a/b.pdf', buf('one'), opts);
    await s.put('pdfs', 'a/b.pdf', buf('two'), opts);
    expect((await s.get('pdfs', 'a/b.pdf'))?.toString()).toBe('two');
  });

  it('returns null for a missing object and keeps buckets separate', async () => {
    const s = make();
    await s.put('pdfs', 'k', buf('x'), opts);
    expect(await s.get('templates', 'k')).toBeNull();
    expect(await s.get('pdfs', 'nope')).toBeNull();
  });

  it('putIfAbsent lets exactly one concurrent caller create', async () => {
    const s = make();
    const results = await Promise.all([
      s.putIfAbsent('pdfs', 'k', buf('1'), opts),
      s.putIfAbsent('pdfs', 'k', buf('2'), opts),
      s.putIfAbsent('pdfs', 'k', buf('3'), opts),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect((await s.get('pdfs', 'k'))?.toString()).toBe('1');
  });

  it('delete treats a missing object as success', async () => {
    const s = make();
    await s.put('pdfs', 'k', buf('x'), opts);
    await s.delete('pdfs', 'k');
    await expect(s.delete('pdfs', 'k')).resolves.toBeUndefined();
    expect(await s.get('pdfs', 'k')).toBeNull();
  });

  it('copy overwrites the target and fails with NotFoundError when the source is missing', async () => {
    const s = make();
    await s.put('pdfs', 'from', buf('src'), opts);
    await s.put('pdfs', 'to', buf('old'), opts);
    await s.copy('pdfs', 'from', 'to');
    expect((await s.get('pdfs', 'to'))?.toString()).toBe('src');
    await expect(s.copy('pdfs', 'missing', 'x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists keys by prefix in lexicographic order', async () => {
    const s = make();
    for (const k of ['b/2', 'a/2', 'a/1', 'ab']) await s.put('pdfs', k, buf('x'), opts);
    await s.put('templates', 'a/3', buf('x'), opts);
    expect(await s.list('pdfs', 'a/')).toEqual(['a/1', 'a/2']);
    expect(await s.list('pdfs', '')).toEqual(['a/1', 'a/2', 'ab', 'b/2']);
  });

  it('builds public URLs without I/O', () => {
    expect(make().publicUrl('x/y.pdf')).toContain('x/y.pdf');
  });
}

describe('FakeStorageGateway', () => {
  storageGatewayBehaviour(() => new FakeStorageGateway());

  it('does not alias stored buffers', async () => {
    const s = new FakeStorageGateway();
    const body = buf('abc');
    await s.put('pdfs', 'k', body, opts);
    body.fill(0);
    expect((await s.get('pdfs', 'k'))?.toString()).toBe('abc');
  });

  it('rejects keys starting with a slash', async () => {
    await expect(new FakeStorageGateway().put('pdfs', '/k', buf('x'), opts)).rejects.toThrow(
      TypeError,
    );
  });

  it('fails with UnavailableError during a simulated outage', async () => {
    const s = new FakeStorageGateway();
    s.setAvailable(false);
    await expect(s.get('pdfs', 'k')).rejects.toBeInstanceOf(UnavailableError);
  });
});
