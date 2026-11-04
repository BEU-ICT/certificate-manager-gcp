import type { BucketKind, PutOptions, StorageGateway } from '../../ports/index.js';
import { NotFoundError, UnavailableError } from '../../shared/errors.js';

export interface StoredObject {
  body: Buffer;
  options: PutOptions;
}

/** In-memory object store; buckets are separate namespaces. */
export class FakeStorageGateway implements StorageGateway {
  readonly objects = new Map<string, StoredObject>();
  private available = true;

  /** Simulates a storage outage: every call fails with `UnavailableError`. */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  put(kind: BucketKind, key: string, body: Buffer, options: PutOptions): Promise<void> {
    return this.run(() => {
      this.objects.set(slot(kind, key), { body: Buffer.from(body), options: { ...options } });
    });
  }

  putIfAbsent(
    kind: BucketKind,
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<{ created: boolean }> {
    return this.run(() => {
      const id = slot(kind, key);
      if (this.objects.has(id)) return { created: false };
      this.objects.set(id, { body: Buffer.from(body), options: { ...options } });
      return { created: true };
    });
  }

  get(kind: BucketKind, key: string): Promise<Buffer | null> {
    return this.run(() => {
      const found = this.objects.get(slot(kind, key));
      return found ? Buffer.from(found.body) : null;
    });
  }

  delete(kind: BucketKind, key: string): Promise<void> {
    return this.run(() => {
      this.objects.delete(slot(kind, key));
    });
  }

  copy(kind: BucketKind, fromKey: string, toKey: string): Promise<void> {
    return this.run(() => {
      const found = this.objects.get(slot(kind, fromKey));
      if (!found) throw new NotFoundError('Object not found');
      this.objects.set(slot(kind, toKey), {
        body: Buffer.from(found.body),
        options: { ...found.options },
      });
    });
  }

  list(kind: BucketKind, prefix: string): Promise<string[]> {
    return this.run(() => {
      const start = `${kind}:`;
      return [...this.objects.keys()]
        .filter((id) => id.startsWith(start + prefix))
        .map((id) => id.slice(start.length))
        .sort();
    });
  }

  publicUrl(key: string): string {
    return `https://storage.example.test/pdfs/${key}`;
  }

  private run<T>(operation: () => T): Promise<T> {
    if (!this.available) return Promise.reject(new UnavailableError());
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function slot(kind: BucketKind, key: string): string {
  if (key.startsWith('/')) throw new TypeError('Storage keys must not start with "/"');
  return `${kind}:${key}`;
}
