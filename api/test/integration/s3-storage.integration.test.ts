import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, PutBucketPolicyCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { S3StorageGateway } from '../../src/adapters/s3/s3-storage-gateway.js';
import { describeStorageGatewayContract } from '../../src/testing/contracts/index.js';

// Runs only against MinIO (CI service, or locally:
//   docker run -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data
//   S3_TEST_ENDPOINT=http://localhost:9000 npm run test:integration).
// Credentials: S3_TEST_ACCESS_KEY / S3_TEST_SECRET_KEY (default minioadmin).
const endpoint = process.env['S3_TEST_ENDPOINT'];
const pdfBucket = `pdf-${randomUUID()}`;
const templatesBucket = `tpl-${randomUUID()}`;
const client = endpoint
  ? new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env['S3_TEST_ACCESS_KEY'] ?? 'minioadmin',
        secretAccessKey: process.env['S3_TEST_SECRET_KEY'] ?? 'minioadmin',
      },
    })
  : undefined;

describe.skipIf(!endpoint)('MinIO (S3_TEST_ENDPOINT)', () => {
  beforeAll(async () => {
    await client!.send(new CreateBucketCommand({ Bucket: pdfBucket }));
    await client!.send(new CreateBucketCommand({ Bucket: templatesBucket }));
    // Public read of objects only (GET/HEAD), no ListBucket => no listing.
    await client!.send(
      new PutBucketPolicyCommand({
        Bucket: pdfBucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${pdfBucket}/*`],
            },
          ],
        }),
      }),
    );
  });

  const gateway = () =>
    new S3StorageGateway({
      client: client!,
      templatesBucket,
      pdfBucket,
      pdfPublicBaseUrl: `${endpoint}/${pdfBucket}`,
    });

  describeStorageGatewayContract('S3StorageGateway (MinIO)', () => ({
    adapter: gateway(),
    cleanup: () => undefined,
  }));

  it('serves PDFs publicly without listing, and deletion is immediate', async () => {
    const s = gateway();
    await s.put('pdfs', 'p/x.pdf', Buffer.from('%PDF'), { contentType: 'application/pdf' });
    const url = s.publicUrl('p/x.pdf');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(`${endpoint}/${pdfBucket}/`)).status).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${endpoint}/${pdfBucket}/?list-type=2`)).status).toBeGreaterThanOrEqual(
      400,
    );
    await s.delete('pdfs', 'p/x.pdf');
    expect((await fetch(url)).status).toBe(404);
  });
});
