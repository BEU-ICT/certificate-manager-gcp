import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
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

describe('FsStorageGateway hardening', () => {
  const opts = { contentType: 'application/pdf' };

  it('rejects bodies above the size limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-fs-'));
    const s = new FsStorageGateway(root, BASE, 4);
    await expect(s.put('pdfs', 'k', Buffer.from('12345'), opts)).rejects.toThrow(RangeError);
    await expect(s.putIfAbsent('pdfs', 'k', Buffer.from('12345'), opts)).rejects.toThrow(
      RangeError,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it('does not follow a symlinked directory out of the bucket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-fs-'));
    const outside = mkdtempSync(join(tmpdir(), 'cm-out-'));
    mkdirSync(join(root, 'pdfs'), { recursive: true });
    symlinkSync(outside, join(root, 'pdfs', 'evil'));
    const s = new FsStorageGateway(root, BASE);
    await expect(s.put('pdfs', 'evil/x.pdf', Buffer.from('x'), opts)).rejects.toThrow(TypeError);
    expect(existsSync(join(outside, 'x.pdf'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('stores files non-executable, writes a metadata sidecar and leaves no temp files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-fs-'));
    const s = new FsStorageGateway(root, BASE);
    await s.put('pdfs', 'a.pdf', Buffer.from('x'), { ...opts, cacheControl: 'no-cache' });
    expect(statSync(join(root, 'pdfs', 'a.pdf')).mode & 0o111).toBe(0);
    expect(JSON.parse(readFileSync(join(root, '.meta', 'pdfs', 'a.pdf.json'), 'utf8'))).toEqual({
      ...opts,
      cacheControl: 'no-cache',
    });
    expect(readdirSync(join(root, '.tmp'))).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it('deleted objects are gone immediately and the sidecar with them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cm-fs-'));
    const s = new FsStorageGateway(root, BASE);
    await s.put('pdfs', 'a.pdf', Buffer.from('x'), opts);
    await s.delete('pdfs', 'a.pdf');
    expect(await s.get('pdfs', 'a.pdf')).toBeNull();
    expect(existsSync(join(root, '.meta', 'pdfs', 'a.pdf.json'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
