import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { BucketKind, PutOptions, StorageGateway, StoredObject } from '../../ports/index.js';
import { NotFoundError, UnavailableError } from '../../shared/errors.js';

/** The slice of `S3Client` this adapter uses, so tests inject a fake. */
export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

export interface S3StorageGatewayOptions {
  client: S3ClientLike;
  templatesBucket: string;
  pdfBucket: string;
  /** `PDF_PUBLIC_BASE_URL`, e.g. `https://files.example.org/pdfs` or the MinIO bucket URL. */
  pdfPublicBaseUrl: string;
  /** Largest accepted object body in bytes (default 50 MiB). */
  maxObjectBytes?: number;
}

export const DEFAULT_MAX_OBJECT_BYTES = 50 * 1024 * 1024;
const PDF_CACHE_CONTROL = 'no-cache';

interface AwsErrorShape {
  name?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
}

function status(error: unknown): number | undefined {
  return (error as AwsErrorShape | null)?.$metadata?.httpStatusCode;
}
function errName(error: unknown): string {
  const e = error as AwsErrorShape | null;
  return e?.name ?? e?.Code ?? '';
}
const isMissing = (error: unknown): boolean =>
  status(error) === 404 || ['NoSuchKey', 'NotFound'].includes(errName(error));
const isPreconditionFailed = (error: unknown): boolean =>
  status(error) === 412 || errName(error) === 'PreconditionFailed';

/**
 * `STORAGE_ADAPTER=s3`: S3-compatible object storage (AWS S3, MinIO). `putIfAbsent` uses
 * `PutObject` with `If-None-Match: *`. Backend failures surface as `UnavailableError`.
 */
export class S3StorageGateway implements StorageGateway {
  private readonly baseUrl: string;
  private readonly maxBytes: number;

  constructor(private readonly options: S3StorageGatewayOptions) {
    this.baseUrl = options.pdfPublicBaseUrl.replace(/\/+$/, '');
    this.maxBytes = options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES;
  }

  private bucket(kind: BucketKind): string {
    return kind === 'pdfs' ? this.options.pdfBucket : this.options.templatesBucket;
  }

  private putInput(kind: BucketKind, key: string, body: Buffer, o: PutOptions) {
    assertKey(key);
    if (body.length > this.maxBytes) throw new RangeError('Object too large');
    return {
      Bucket: this.bucket(kind),
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: o.contentType,
      CacheControl: o.cacheControl ?? (kind === 'pdfs' ? PDF_CACHE_CONTROL : undefined),
      ContentDisposition: o.contentDisposition,
    };
  }

  async put(kind: BucketKind, key: string, body: Buffer, options: PutOptions): Promise<void> {
    const input = this.putInput(kind, key, body, options);
    try {
      await this.options.client.send(new PutObjectCommand(input));
    } catch {
      throw new UnavailableError();
    }
  }

  async putIfAbsent(
    kind: BucketKind,
    key: string,
    body: Buffer,
    options: PutOptions,
  ): Promise<{ created: boolean }> {
    const input = this.putInput(kind, key, body, options);
    try {
      await this.options.client.send(new PutObjectCommand({ ...input, IfNoneMatch: '*' }));
      return { created: true };
    } catch (error) {
      // 412 PreconditionFailed; 409 ConditionalRequestConflict (concurrent writers on S3).
      if (isPreconditionFailed(error) || status(error) === 409) return { created: false };
      throw new UnavailableError();
    }
  }

  async get(kind: BucketKind, key: string): Promise<Buffer | null> {
    assertKey(key);
    try {
      const out = (await this.options.client.send(
        new GetObjectCommand({ Bucket: this.bucket(kind), Key: key }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!out.Body) throw new UnavailableError();
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (error) {
      if (isMissing(error)) return null;
      throw new UnavailableError();
    }
  }

  async delete(kind: BucketKind, key: string): Promise<void> {
    assertKey(key);
    try {
      await this.options.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket(kind), Key: key }),
      );
    } catch (error) {
      if (!isMissing(error)) throw new UnavailableError();
    }
  }

  async copy(kind: BucketKind, fromKey: string, toKey: string): Promise<void> {
    assertKey(fromKey);
    assertKey(toKey);
    const bucket = this.bucket(kind);
    try {
      await this.options.client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: toKey,
          CopySource: `${bucket}/${fromKey.split('/').map(encodeURIComponent).join('/')}`,
        }),
      );
    } catch (error) {
      if (isMissing(error)) throw new NotFoundError('Object not found');
      throw new UnavailableError();
    }
  }

  async list(kind: BucketKind, prefix: string): Promise<StoredObject[]> {
    if (prefix.includes('\0') || prefix.startsWith('/')) throw new TypeError('Invalid prefix');
    const found: StoredObject[] = [];
    try {
      let token: string | undefined;
      do {
        const out = (await this.options.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket(kind),
            Prefix: prefix || undefined,
            ContinuationToken: token,
          }),
        )) as {
          Contents?: Array<{ Key?: string; Size?: number }>;
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        };
        for (const o of out.Contents ?? []) {
          if (o.Key !== undefined) found.push({ key: o.Key, size: o.Size ?? 0 });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
    } catch {
      throw new UnavailableError();
    }
    return found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}

function assertKey(key: string): void {
  if (key === '' || key.includes('\0') || key.startsWith('/')) throw new TypeError('Invalid key');
}
