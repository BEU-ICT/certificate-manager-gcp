/** Logical bucket; adapters map it to a concrete bucket/directory. Never a bucket name. */
export type BucketKind = 'templates' | 'pdfs';

export interface PutOptions {
  contentType: string;
  cacheControl?: string;
  contentDisposition?: string;
}

/**
 * Object storage. Keys are `/`-separated, never start with `/`.
 * Failures of the backing service surface as `UnavailableError`.
 */
export interface StorageGateway {
  /** Creates or overwrites the object. */
  put(kind: BucketKind, key: string, body: Buffer, options: PutOptions): Promise<void>;
  /**
   * Creates the object only if absent (portable "write once"). Exactly one of
   * concurrent callers gets `created: true`.
   */
  putIfAbsent(
    kind: BucketKind,
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<{ created: boolean }>;
  /** `null` when the object does not exist. */
  get(kind: BucketKind, key: string): Promise<Buffer | null>;
  /** A missing object counts as success. */
  delete(kind: BucketKind, key: string): Promise<void>;
  /** Fails with `NotFoundError` when `fromKey` is missing; overwrites `toKey`. */
  copy(kind: BucketKind, fromKey: string, toKey: string): Promise<void>;
  /** Keys starting with `prefix`, lexicographic order. */
  list(kind: BucketKind, prefix: string): Promise<string[]>;
  /** Public URL of a PDF key; pure, performs no I/O. */
  publicUrl(key: string): string;
}
