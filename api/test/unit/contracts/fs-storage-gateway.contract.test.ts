import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsStorageGateway } from '../../../src/adapters/fs/index.js';
import { describeStorageGatewayContract } from '../../../src/testing/contracts/index.js';

const BASE = 'http://localhost:8080';

describeStorageGatewayContract('FsStorageGateway (fs)', () => {
  const root = mkdtempSync(join(tmpdir(), 'cm-fs-'));
  return {
    adapter: new FsStorageGateway(root, BASE),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
});

describe('FsStorageGateway specifics', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-fs-'));
    return { root, s: new FsStorageGateway(join(root, 'store'), BASE) };
  };
  const opts = { contentType: 'text/plain' };

  it.each(['../x', 'a/../../x', '/abs', 'a//b', './a', 'a\\b', '', 'a/\0b', '..'])(
    'rejects unsafe key %j',
    async (key) => {
      const { root, s } = setup();
      await expect(s.put('pdfs', key, Buffer.from('x'), opts)).rejects.toThrow(TypeError);
      await expect(s.get('templates', key)).rejects.toThrow(TypeError);
      rmSync(root, { recursive: true, force: true });
    },
  );

  it('keeps metadata out of listings and copies it', async () => {
    const { root, s } = setup();
    await s.put('pdfs', 'a/b.pdf', Buffer.from('x'), { contentType: 'application/pdf' });
    await s.copy('pdfs', 'a/b.pdf', 'c.pdf');
    expect((await s.list('pdfs', '')).map((o) => o.key)).toEqual(['a/b.pdf', 'c.pdf']);
    expect(await s.list('templates', '')).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it('survives a new instance on the same root and builds public URLs', async () => {
    const { root, s } = setup();
    await s.put('templates', 't/config.json', Buffer.from('{}'), opts);
    const again = new FsStorageGateway(join(root, 'store'), `${BASE}/`);
    expect((await again.get('templates', 't/config.json'))?.toString()).toBe('{}');
    expect(again.publicUrl('k.pdf')).toBe(`${BASE}/pdfs/k.pdf`);
    rmSync(root, { recursive: true, force: true });
  });
});
