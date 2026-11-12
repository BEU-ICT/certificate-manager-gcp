import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  chunkIdempotencyKey,
  csvCell,
  parseItemPath,
  sha256Hex,
  splitChunks,
  windowRange,
} from './bulk-core';

describe('csvCell', () => {
  it('neutralises formula starters and quotes special characters', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@a')).toBe("'@a");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
  });
  it('writes a BOM and CRLF rows', async () => {
    const blob = buildCsv([['a', '=b'], ['c']]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(
      "\ufeffa,'=b\r\nc\r\n",
    );
  });
});

describe('chunks and keys', () => {
  it('splits into parts of at most 500', () => {
    expect(splitChunks(Array.from({ length: 1200 }, (_, i) => i)).map((c) => c.length)).toEqual([
      500, 500, 200,
    ]);
  });
  it('hashes deterministically and varies with every input', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const file = { name: 'a.csv', size: 10, lastModified: 5 };
    const base = await chunkIdempotencyKey(file, 0, 'h');
    expect(await chunkIdempotencyKey(file, 0, 'h')).toBe(base);
    expect(await chunkIdempotencyKey(file, 1, 'h')).not.toBe(base);
    expect(await chunkIdempotencyKey(file, 0, 'x')).not.toBe(base);
    expect(await chunkIdempotencyKey({ ...file, size: 11 }, 0, 'h')).not.toBe(base);
  });
});

describe('parseItemPath', () => {
  it('reads the item index and field', () => {
    expect(parseItemPath('items[17].ownerName')).toEqual({ index: 17, field: 'ownerName' });
    expect(parseItemPath('items[3]')).toEqual({ index: 3, field: '' });
    expect(parseItemPath('templateId')).toBeNull();
  });
});

describe('windowRange', () => {
  const base = { rowHeight: 64, viewportHeight: 480, overscan: 8 };
  it('renders everything for short lists', () => {
    expect(windowRange({ ...base, count: 500, scrollTop: 0 })).toEqual({
      start: 0,
      end: 500,
      before: 0,
      after: 0,
    });
  });
  it('renders the rows in view plus overscan for long lists', () => {
    const r = windowRange({ ...base, count: 5000, scrollTop: 64 * 1000 });
    expect(r.start).toBe(992);
    expect(r.end).toBe(1000 + 8 + 8);
    expect(r.before).toBe(992 * 64);
    expect(r.after).toBe((5000 - r.end) * 64);
    expect(windowRange({ ...base, count: 5000, scrollTop: 0 }).start).toBe(0);
    expect(windowRange({ ...base, count: 5000, scrollTop: 64 * 5000 }).end).toBe(5000);
  });
});
