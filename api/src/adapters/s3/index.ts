import { S3Client } from '@aws-sdk/client-s3';
import type { StorageGateway } from '../../ports/index.js';
import type { AdapterContext } from '../registry.js';
import { AdapterError } from '../registry.js';
import { S3StorageGateway } from './s3-storage-gateway.js';

export { S3StorageGateway } from './s3-storage-gateway.js';

/**
 * `STORAGE_ADAPTER=s3`. `S3_ENDPOINT` selects MinIO or another S3-compatible service,
 * `S3_FORCE_PATH_STYLE=true` is needed for MinIO without wildcard DNS. Without
 * `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` the SDK's default credential chain applies.
 */
export function createStorageGateway({ config }: AdapterContext): StorageGateway {
  const { templatesBucket, pdfBucket, s3 } = config.storage;
  if (!templatesBucket || !pdfBucket) {
    throw new AdapterError('STORAGE_ADAPTER: s3 needs TEMPLATES_BUCKET and PDF_BUCKET');
  }
  const client = new S3Client({
    region: s3.region,
    ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
    forcePathStyle: s3.forcePathStyle,
    ...(s3.accessKeyId && s3.secretAccessKey
      ? { credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey } }
      : {}),
  });
  return new S3StorageGateway({
    client,
    templatesBucket,
    pdfBucket,
    pdfPublicBaseUrl: config.pdfPublicBaseUrl,
  });
}
