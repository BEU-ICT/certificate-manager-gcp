import { Storage } from '@google-cloud/storage';
import type { StorageGateway } from '../../ports/index.js';
import type { AdapterContext } from '../registry.js';
import { AdapterError } from '../registry.js';
import { GcsStorageGateway } from './gcs-storage-gateway.js';

/** `STORAGE_EMULATOR_HOST` (`host:port` or a URL) as an http(s) origin; `undefined` when unset. */
export function emulatorEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const host = env['STORAGE_EMULATOR_HOST']?.replace(/\/+$/, '');
  if (!host) return undefined;
  return /^https?:\/\//.test(host) ? host : `http://${host}`;
}

/**
 * Builds the Cloud Storage client. With `STORAGE_EMULATOR_HOST` set (fake-gcs-server) the client
 * talks to that origin over plain http without credentials. The client's own handling of the
 * variable is unusable for a bare `host:port` (https is assumed, and it uses the value as JSON API
 * base URL for metadata calls but as origin for uploads), so the endpoint is passed as the
 * documented `apiEndpoint` option and the variable is hidden while the client is constructed.
 */
export function createStorageClient(
  projectId: string,
  env: NodeJS.ProcessEnv = process.env,
): Storage {
  const endpoint = emulatorEndpoint(env);
  if (endpoint === undefined) return new Storage({ projectId });
  const original = env['STORAGE_EMULATOR_HOST'];
  delete env['STORAGE_EMULATOR_HOST'];
  try {
    return new Storage({ projectId, apiEndpoint: endpoint });
  } finally {
    if (original !== undefined) env['STORAGE_EMULATOR_HOST'] = original;
  }
}

/**
 * `STORAGE_ADAPTER=gcs`. Credentials come from the runtime service account (ADC); with
 * `STORAGE_EMULATOR_HOST` set the client talks to fake-gcs-server and sends none.
 */
export function createStorageGateway({ config }: AdapterContext): StorageGateway {
  const { templatesBucket, pdfBucket } = config.storage;
  if (!templatesBucket || !pdfBucket) {
    throw new AdapterError('STORAGE_ADAPTER: gcs needs TEMPLATES_BUCKET and PDF_BUCKET');
  }
  return new GcsStorageGateway({
    client: createStorageClient(config.gcpProject),
    templatesBucket,
    pdfBucket,
    pdfPublicBaseUrl: config.pdfPublicBaseUrl,
  });
}
