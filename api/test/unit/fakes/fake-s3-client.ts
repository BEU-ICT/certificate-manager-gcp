/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import type { S3ClientLike } from '../../../src/adapters/s3/s3-storage-gateway.js';

interface Stored {
  body: Buffer;
  contentType?: string;
  cacheControl?: string;
}

function awsError(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
}

/** In-memory S3 honouring the commands the adapter uses (incl. `If-None-Match: *`). */
export class FakeS3Client implements S3ClientLike {
  readonly objects = new Map<string, Stored>();
  failWith: Error | undefined;
  /** Page size for ListObjectsV2, to exercise pagination. */
  pageSize = 1000;

  send(command: unknown): Promise<unknown> {
    try {
      return Promise.resolve(this.handle(command));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handle(raw: unknown): unknown {
    if (this.failWith) throw this.failWith;
    const command = raw as { input: any; constructor: { name: string } };
    const name = command.constructor.name;
    if (name === 'PutObjectCommand') {
      const i = command.input;
      const k = `${i.Bucket}/${i.Key}`;
      if (i.IfNoneMatch === '*' && this.objects.has(k)) throw awsError('PreconditionFailed', 412);
      this.objects.set(k, {
        body: Buffer.from(i.Body as Buffer),
        contentType: i.ContentType,
        cacheControl: i.CacheControl,
      });
      return {};
    }
    if (name === 'GetObjectCommand') {
      const o = this.objects.get(`${command.input.Bucket}/${command.input.Key}`);
      if (!o) throw awsError('NoSuchKey', 404);
      return { Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(o.body)) } };
    }
    if (name === 'DeleteObjectCommand') {
      this.objects.delete(`${command.input.Bucket}/${command.input.Key}`);
      return {};
    }
    if (name === 'CopyObjectCommand') {
      const src = this.objects.get(decodeURIComponent(command.input.CopySource ?? ''));
      if (!src) throw awsError('NoSuchKey', 404);
      this.objects.set(`${command.input.Bucket}/${command.input.Key}`, { ...src });
      return {};
    }
    if (name === 'ListObjectsV2Command') {
      const { Bucket, Prefix = '', ContinuationToken } = command.input;
      const keys = [...this.objects.keys()]
        .filter((k) => k.startsWith(`${Bucket}/`))
        .map((k) => k.slice(Bucket!.length + 1))
        .filter((k) => k.startsWith(Prefix))
        .sort();
      const start = ContinuationToken ? Number(ContinuationToken) : 0;
      const page = keys.slice(start, start + this.pageSize);
      const more = start + this.pageSize < keys.length;
      return {
        Contents: page.map((Key) => ({
          Key,
          Size: this.objects.get(`${Bucket}/${Key}`)!.body.length,
        })),
        IsTruncated: more,
        NextContinuationToken: more ? String(start + this.pageSize) : undefined,
      };
    }
    throw new Error('unsupported command');
  }
}
