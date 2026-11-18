import { randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { BucketKind, PutOptions, StorageGateway, StoredObject } from '../../ports/index.js';
import { NotFoundError, UnavailableError } from '../../shared/errors.js';

/** Default root of the local-profile object store; git-ignored. */
export const DEFAULT_FS_ROOT = '.local-data/storage';

/** Largest accepted object body in bytes (50 MiB) unless the constructor overrides it. */
export const DEFAULT_FS_MAX_OBJECT_BYTES = 50 * 1024 * 1024;

/**
 * Object storage on the local file system (`STORAGE_ADAPTER=fs`), for local runs and tests.
 * Layout under `root`: `templates/<key>` and `pdfs/<key>` mirror the two buckets; `.meta/<kind>/<key>.json`
 * keeps content type / cache headers; `.tmp/` holds in-flight writes. Writes are atomic
 * (temp file + rename, `putIfAbsent` via hard link, which fails when the target exists).
 */
export class FsStorageGateway implements StorageGateway {
  private readonly root: string;

  constructor(
    root: string,
    private readonly pdfPublicBaseUrl: string,
    private readonly maxObjectBytes: number = DEFAULT_FS_MAX_OBJECT_BYTES,
  ) {
    this.root = resolve(root);
  }

  async put(kind: BucketKind, key: string, body: Buffer, options: PutOptions): Promise<void> {
    const target = this.objectPath(kind, key);
    this.assertSize(body);
    await this.io(async () => {
      const tmp = await this.writeTemp(body);
      try {
        await this.ensureDir(kind, target);
        await rename(tmp, target);
      } catch (error) {
        await rm(tmp, { force: true });
        throw error;
      }
      await this.writeMeta(kind, key, options);
    });
  }

  async putIfAbsent(
    kind: BucketKind,
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<{ created: boolean }> {
    const target = this.objectPath(kind, key);
    this.assertSize(body);
    return this.io(async () => {
      const tmp = await this.writeTemp(body);
      try {
        await this.ensureDir(kind, target);
        await link(tmp, target);
      } catch (error) {
        if (code(error) === 'EEXIST') return { created: false };
        throw error;
      } finally {
        await rm(tmp, { force: true });
      }
      await this.writeMeta(kind, key, options);
      return { created: true };
    });
  }

  async get(kind: BucketKind, key: string): Promise<Buffer | null> {
    const target = this.objectPath(kind, key);
    return this.io(async () => {
      try {
        return await readFile(target);
      } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(code(error) ?? '')) return null;
        throw error;
      }
    });
  }

  async delete(kind: BucketKind, key: string): Promise<void> {
    const target = this.objectPath(kind, key);
    await this.io(async () => {
      await unlink(target).catch(ignore('ENOENT', 'ENOTDIR', 'EISDIR'));
      await unlink(this.metaPath(kind, key)).catch(ignore('ENOENT', 'ENOTDIR', 'EISDIR'));
    });
  }

  async copy(kind: BucketKind, fromKey: string, toKey: string): Promise<void> {
    const body = await this.get(kind, fromKey);
    if (body === null) throw new NotFoundError('Object not found');
    const meta = await this.readMeta(kind, fromKey);
    await this.put(kind, toKey, body, meta ?? { contentType: 'application/octet-stream' });
  }

  async list(kind: BucketKind, prefix: string): Promise<StoredObject[]> {
    if (prefix.includes('\0') || prefix.startsWith('/')) throw new TypeError('Invalid prefix');
    const base = join(this.root, kind);
    const found: StoredObject[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (code(error) === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const key = rel + entry.name;
        if (entry.isDirectory()) await walk(join(dir, entry.name), `${key}/`);
        else if (key.startsWith(prefix)) {
          try {
            found.push({ key, size: (await stat(join(dir, entry.name))).size });
          } catch (error) {
            // Deleted between readdir and stat: not listed.
            if (code(error) !== 'ENOENT') throw error;
          }
        }
      }
    };
    await this.io(() => walk(base, ''));
    return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  publicUrl(key: string): string {
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    return `${this.pdfPublicBaseUrl.replace(/\/+$/, '')}/pdfs/${encoded}`;
  }

  /** Filesystem path of a key (traversal-safe); used by the local public-PDF route. */
  objectPath(kind: BucketKind, key: string): string {
    return this.safePath(join(this.root, kind), key);
  }

  private metaPath(kind: BucketKind, key: string): string {
    return `${this.safePath(join(this.root, '.meta', kind), key)}.json`;
  }

  private safePath(base: string, key: string): string {
    if (!isSafeKey(key)) throw new TypeError('Invalid storage key');
    const path = resolve(base, ...key.split('/'));
    if (!path.startsWith(base + sep)) throw new TypeError('Invalid storage key');
    return path;
  }

  private assertSize(body: Buffer): void {
    if (body.length > this.maxObjectBytes) throw new RangeError('Object too large');
  }

  /** Creates the parent directory and refuses to continue when it resolves outside the bucket (symlinks). */
  private async ensureDir(kind: BucketKind, target: string): Promise<void> {
    const dir = dirname(target);
    await mkdir(dir, { recursive: true, mode: 0o755 });
    const base = join(this.root, kind);
    const [realDir, realBase] = await Promise.all([realpath(dir), realpath(base)]);
    if (realDir !== realBase && !realDir.startsWith(realBase + sep)) {
      throw new TypeError('Invalid storage key');
    }
  }

  private async writeTemp(body: Buffer): Promise<string> {
    const dir = join(this.root, '.tmp');
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, randomUUID());
    await writeFile(tmp, body, { mode: 0o644 });
    return tmp;
  }

  private async writeMeta(kind: BucketKind, key: string, options: PutOptions): Promise<void> {
    const path = this.metaPath(kind, key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = await this.writeTemp(Buffer.from(JSON.stringify(options)));
    try {
      await rename(tmp, path);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  private async readMeta(kind: BucketKind, key: string): Promise<PutOptions | null> {
    try {
      return JSON.parse(await readFile(this.metaPath(kind, key), 'utf8')) as PutOptions;
    } catch {
      return null;
    }
  }

  /** Maps unexpected filesystem failures to `UnavailableError`; domain errors pass through. */
  private async io<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof NotFoundError ||
        error instanceof TypeError ||
        error instanceof RangeError
      )
        throw error;
      throw new UnavailableError();
    }
  }
}

/** Keys: `/`-separated, no empty/`.`/`..` segments, no backslash, no NUL, not absolute. */
export function isSafeKey(key: string): boolean {
  if (key === '' || key.includes('\0') || key.includes('\\') || key.startsWith('/')) return false;
  return key.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function code(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

function ignore(...codes: string[]) {
  return (error: unknown): void => {
    if (!codes.includes(code(error) ?? '')) throw error;
  };
}
