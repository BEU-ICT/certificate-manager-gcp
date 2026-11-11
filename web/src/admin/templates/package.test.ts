import { describe, expect, it } from 'vitest';
import {
  entriesFromDrop,
  mapPickedFiles,
  precheck,
  referencedFiles,
  type ConfigState,
  type FsEntry,
  type PackageEntry,
} from './package';

function file(name: string, size = 10, relative = ''): File {
  const f = new File([new Uint8Array(size)], name.split('/').pop() ?? name);
  Object.defineProperty(f, 'webkitRelativePath', { value: relative });
  return f;
}
const entry = (path: string, size = 10): PackageEntry => ({ path, file: file(path, size) });
const ok = (value: unknown = {}): ConfigState => ({ status: 'ok', value });
const keys = (entries: PackageEntry[], config: ConfigState) =>
  precheck(entries, config).map((i) => `${i.key}:${i.path}`);

describe('mapPickedFiles', () => {
  it('strips the folder prefix of a folder pick and ignores OS junk', () => {
    const mapped = mapPickedFiles([
      file('config.json', 5, 'pack/config.json'),
      file('a.ttf', 5, 'pack/fonts/a.ttf'),
      file('.DS_Store', 5, 'pack/.DS_Store'),
    ]);
    expect(mapped.map((e) => e.path)).toEqual(['config.json', 'fonts/a.ttf']);
  });

  it('uses the file name for loose files', () => {
    expect(mapPickedFiles([file('background.svg')]).map((e) => e.path)).toEqual(['background.svg']);
  });
});

describe('entriesFromDrop', () => {
  const fileEntry = (name: string): FsEntry => ({
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => success(file(name)),
  });
  const dir = (name: string, children: FsEntry[]): FsEntry => {
    let done = false;
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => ({
        readEntries: (success) => {
          success(done ? [] : children);
          done = true;
        },
      }),
    };
  };

  it('walks a dropped folder and strips its name', async () => {
    const root = dir('pack', [fileEntry('config.json'), dir('fonts', [fileEntry('a.ttf')])]);
    const dt = {
      items: [{ webkitGetAsEntry: () => root }],
      files: [],
    } as unknown as DataTransfer;
    expect((await entriesFromDrop(dt)).map((e) => e.path).sort()).toEqual([
      'config.json',
      'fonts/a.ttf',
    ]);
  });
});

describe('entriesFromDrop limits', () => {
  it('stops early and skips dot-directories and node_modules', async () => {
    const fileEntry = (name: string): FsEntry => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (success) => success(file(name)),
    });
    const dir = (name: string, children: FsEntry[]): FsEntry => {
      let done = false;
      return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => ({
          readEntries: (success) => {
            success(done ? [] : children);
            done = true;
          },
        }),
      };
    };
    const many = Array.from({ length: 500 }, (_, i) => fileEntry(`${String(i)}.png`));
    const root = dir('pack', [
      dir('node_modules', [fileEntry('x.png')]),
      dir('.git', [fileEntry('y.png')]),
      ...many,
    ]);
    const dt = { items: [{ webkitGetAsEntry: () => root }], files: [] } as unknown as DataTransfer;
    const paths = (await entriesFromDrop(dt)).map((e) => e.path);
    expect(paths.length).toBeLessThan(100);
    expect(paths).not.toContain('node_modules/x.png');
    expect(paths).not.toContain('.git/y.png');
  });
});

describe('referencedFiles', () => {
  it('lists background, images and fonts with config paths', () => {
    expect(
      referencedFiles({
        background: 'background.svg',
        images: [{ file: 'assets/a.png' }],
        fonts: { main: 'fonts/a.ttf' },
      }),
    ).toEqual([
      { path: 'background', file: 'background.svg' },
      { path: 'images[0].file', file: 'assets/a.png' },
      { path: 'fonts.main', file: 'fonts/a.ttf' },
    ]);
  });
});

describe('precheck', () => {
  it('accepts a valid package', () => {
    const config = ok({ background: 'background.svg', fonts: { main: 'fonts/a.ttf' } });
    const entries = [entry('config.json'), entry('background.svg'), entry('fonts/a.ttf')];
    expect(precheck(entries, config)).toEqual([]);
  });

  it('reports a missing or invalid config', () => {
    expect(keys([entry('background.svg')], { status: 'missing' })).toEqual(['configMissing:']);
    expect(keys([entry('config.json')], { status: 'invalid' })).toEqual([
      'configInvalid:config.json',
    ]);
  });

  it('reports disallowed extensions, bad names and oversize files', () => {
    const entries = [
      entry('config.json'),
      entry('notes.txt'),
      entry('my file.png'),
      entry('fonts/big.ttf', 3 * 1024 * 1024 + 1),
    ];
    expect(keys(entries, ok())).toEqual([
      'layout:notes.txt',
      'badName:my file.png',
      'fileTooLarge:fonts/big.ttf',
    ]);
  });

  it('reports file count and total size', () => {
    const many = Array.from({ length: 31 }, (_, i) => entry(`assets/${String(i)}.png`));
    expect(keys([entry('config.json'), ...many], ok())).toContain('tooManyFiles:');
    const big = [
      entry('config.json'),
      entry('a.png', 4_000_000),
      entry('b.png', 4_000_000),
      entry('c.png', 4_000_000),
    ];
    expect(keys(big, ok())).toContain('totalTooLarge:');
  });

  it('rejects files outside the storage layout', () => {
    const entries = [
      entry('config.json'),
      entry('docs/a.png'),
      entry('fonts/sub/a.ttf'),
      entry('assets/a.svg'),
    ];
    expect(keys(entries, ok())).toEqual([
      'layout:docs/a.png',
      'layout:fonts/sub/a.ttf',
      'layout:assets/a.svg',
    ]);
  });

  it('flags an oversize config.json', () => {
    expect(keys([entry('config.json', 5 * 1024 * 1024 + 1)], { status: 'tooLarge' })).toEqual([
      'fileTooLarge:config.json',
    ]);
  });

  it('reports referenced files that are missing', () => {
    expect(keys([entry('config.json')], ok({ background: 'background.svg' }))).toEqual([
      'referencedMissing:background',
    ]);
  });
});
