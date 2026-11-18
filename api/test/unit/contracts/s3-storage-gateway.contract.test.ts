import { describe, expect, it } from 'vitest';
import { S3StorageGateway } from '../../../src/adapters/s3/s3-storage-gateway.js';
import { describeStorageGatewayContract } from '../../../src/testing/contracts/index.js';
import { UnavailableError } from '../../../src/shared/errors.js';
import { FakeS3Client } from '../fakes/fake-s3-client.js';

// The real client is exercised by test/integration/s3-storage.integration.test.ts (MinIO).
const make = (client = new FakeS3Client(), extra: { maxObjectBytes?: number } = {}) =>
  new S3StorageGateway({
    client,
    templatesBucket: 'tpl',
    pdfBucket: 'pdf',
    pdfPublicBaseUrl: 'http://minio:9000/pdf/',
    ...extra,
  });

describeStorageGatewayContract('S3StorageGateway (fake client)', () => ({
  adapter: make(),
  cleanup: () => undefined,
}));

describe('S3StorageGateway specifics', () => {
  const opts = { contentType: 'application/pdf' };

  it('builds public URLs from PDF_PUBLIC_BASE_URL', () => {
    expect(make().publicUrl('a b/c.pdf')).toBe('http://minio:9000/pdf/a%20b/c.pdf');
  });

  it('sets no-cache on PDFs and uses the per-kind bucket', async () => {
    const client = new FakeS3Client();
    await make(client).put('pdfs', 'a.pdf', Buffer.from('x'), opts);
    expect(client.objects.get('pdf/a.pdf')?.cacheControl).toBe('no-cache');
  });

  it('lists across pages', async () => {
    const client = new FakeS3Client();
    client.pageSize = 2;
    const s = make(client);
    for (const k of ['a', 'b', 'c', 'd', 'e']) await s.put('templates', k, Buffer.from(k), opts);
    expect((await s.list('templates', '')).map((o) => o.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('maps backend failures to UnavailableError and rejects oversize bodies', async () => {
    const client = new FakeS3Client();
    client.failWith = Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } });
    const s = make(client, { maxObjectBytes: 3 });
    await expect(s.get('pdfs', 'k')).rejects.toBeInstanceOf(UnavailableError);
    await expect(s.putIfAbsent('pdfs', 'k', Buffer.from('x'), opts)).rejects.toBeInstanceOf(
      UnavailableError,
    );
    await expect(s.put('pdfs', 'k', Buffer.from('toolong'), opts)).rejects.toThrow(RangeError);
  });
});
