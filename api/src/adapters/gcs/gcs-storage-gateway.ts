import type { BucketKind, PutOptions, StorageGateway, StoredObject } from '../../ports/index.js';
import { NotFoundError, UnavailableError } from '../../shared/errors.js';

/** The slice of `@google-cloud/storage` this adapter uses, so tests inject a mock or fake. */
export interface GcsFileLike {
  save(
    data: Buffer,
    options: {
      resumable: false;
      contentType: string;
      metadata?: { cacheControl?: string; contentDisposition?: string };
      preconditionOpts?: { ifGenerationMatch: number };
    },
  ): Promise<unknown>;
  download(): Promise<[Buffer]>;
  delete(options: { ignoreNotFound: true }): Promise<unknown>;
  /** `destination` is another file of the same client (a `File` for the real client). */
  copy(destination: unknown): Promise<unknown>;
}

export interface GcsBucketLike {
  file(name: string): GcsFileLike;
  getFiles(query: {
    prefix: string;
    autoPaginate: true;
  }): Promise<
    readonly [Array<{ name: string; metadata?: { size?: string | number } }>, ...unknown[]]
  >;
}

export interface GcsClientLike {
  bucket(name: string): GcsBucketLike;
}

export interface GcsStorageGatewayOptions {
  client: GcsClientLike;
  templatesBucket: string;
  pdfBucket: string;
  /** `PDF_PUBLIC_BASE_URL`, e.g. `https://storage.googleapis.com/<project>-pdfs`. */
  pdfPublicBaseUrl: string;
}

/** Public PDFs must never be served stale after a revocation (docs/storage.md). */
const PDF_CACHE_CONTROL = 'no-cache';

function codeOf(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : undefined;
}

/** `STORAGE_ADAPTER=gcs`: Cloud Storage; every backend failure surfaces as `UnavailableError`. */
export class GcsStorageGateway implements StorageGateway {
  private readonly baseUrl: string;

  constructor(private readonly options: GcsStorageGatewayOptions) {
    this.baseUrl = options.pdfPublicBaseUrl.replace(/\/+$/, '');
  }

  async put(kind: BucketKind, key: string, body: Buffer, options: PutOptions): Promise<void> {
    try {
      await this.file(kind, key).save(body, this.saveOptions(kind, options));
    } catch (error) {
      throw unavailable(error);
    }
  }

  async putIfAbsent(
    kind: BucketKind,
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<{ created: boolean }> {
    try {
      await this.file(kind, key).save(body, {
        ...this.saveOptions(kind, options),
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      return { created: true };
    } catch (error) {
      if (codeOf(error) === 412) return { created: false };
      throw unavailable(error);
    }
  }

  async get(kind: BucketKind, key: string): Promise<Buffer | null> {
    try {
      const [body] = await this.file(kind, key).download();
      return body;
    } catch (error) {
      if (codeOf(error) === 404) return null;
      throw unavailable(error);
    }
  }

  async delete(kind: BucketKind, key: string): Promise<void> {
    try {
      await this.file(kind, key).delete({ ignoreNotFound: true });
    } catch (error) {
      if (codeOf(error) === 404) return;
      throw unavailable(error);
    }
  }

  async copy(kind: BucketKind, fromKey: string, toKey: string): Promise<void> {
    try {
      await this.file(kind, fromKey).copy(this.file(kind, toKey));
    } catch (error) {
      if (codeOf(error) === 404) throw new NotFoundError('Object not found');
      throw unavailable(error);
    }
  }

  async list(kind: BucketKind, prefix: string): Promise<StoredObject[]> {
    try {
      const [files] = await this.bucket(kind).getFiles({ prefix, autoPaginate: true });
      // GCS lists in UTF-8 byte order; sorting keeps the contract for any client/emulator.
      return files
        .map((file) => ({ key: file.name, size: Number(file.metadata?.size ?? 0) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    } catch (error) {
      throw unavailable(error);
    }
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  private bucket(kind: BucketKind): GcsBucketLike {
    return this.options.client.bucket(
      kind === 'templates' ? this.options.templatesBucket : this.options.pdfBucket,
    );
  }

  private file(kind: BucketKind, key: string): GcsFileLike {
    if (key === '' || key.startsWith('/')) throw new RangeError('key must not start with "/"');
    return this.bucket(kind).file(key);
  }

  private saveOptions(kind: BucketKind, options: PutOptions) {
    const cacheControl = options.cacheControl ?? (kind === 'pdfs' ? PDF_CACHE_CONTROL : undefined);
    const metadata = {
      ...(cacheControl === undefined ? {} : { cacheControl }),
      ...(options.contentDisposition === undefined
        ? {}
        : { contentDisposition: options.contentDisposition }),
    };
    return {
      resumable: false as const,
      contentType: options.contentType,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  }
}

function unavailable(error: unknown): Error {
  if (error instanceof RangeError) return error; // invalid key: a caller bug, not an outage
  const wrapped = new UnavailableError(5, 'Storage temporarily unavailable');
  wrapped.cause = error;
  return wrapped;
}
